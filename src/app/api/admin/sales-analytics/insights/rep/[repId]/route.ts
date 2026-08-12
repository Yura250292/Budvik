/**
 * АІ-інсайти по одному торговому.
 *
 * GET  — віддає кеш (або порожньо, якщо ще не генерували).
 * POST — рахує факти й генерує заново.
 *
 * Розділення навмисне: генерація коштує токенів, тож вона має бути явною
 * дією керівника, а не побічним ефектом відкриття сторінки.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";
import { clientPortfolio } from "@/lib/analytics/clients";
import { repTrend } from "@/lib/analytics/trends";
import { revenueByRep, returnsByClient } from "@/lib/analytics/facts";
import { receivableRowsByRep, sumAging } from "@/lib/analytics/money-facts";
import { generateInsights, insightsConfigured } from "@/lib/ai/insights";
import { readReport, writeReport } from "@/lib/ai/insight-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

/** Скільки клієнтів кожного стану показувати моделі. */
const CLIENTS_PER_STATE = 12;

/** Скільки клієнтів із поверненнями показувати моделі. */
const RETURN_CLIENTS = 8;

/** День перед датою YYYY-MM-DD — верхня межа попереднього вікна темпу. */
function dayBefore(day: string): string {
  return new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10);
}

async function guard(req: NextRequest, repId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Не авторизовано" }, { status: 401 }) };
  }

  const role = session.user.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  if (!isFullAccess && (role !== "SALES" || session.user.id !== repId)) {
    return { error: NextResponse.json({ error: "Немає доступу" }, { status: 403 }) };
  }

  const rep = await prisma.user.findUnique({
    where: { id: repId },
    select: { id: true, name: true },
  });
  if (!rep) {
    return { error: NextResponse.json({ error: "Торгового не знайдено" }, { status: 404 }) };
  }

  return { rep, period: parsePeriod(new URL(req.url).searchParams) };
}

/**
 * Зведення для моделі.
 *
 * Свідомо компактне: клієнтів сотні, а модель однаково побачить лише
 * закономірність. Беремо найбільших у кожному стані — саме вони визначають
 * і масштаб проблеми, і те, з ким говорити першим.
 */
async function buildFacts(repId: string, repName: string | null, period: ReturnType<typeof parsePeriod>) {
  const [trend, portfolio, revenue, receivables, returnClients] = await Promise.all([
    repTrend(repId, period),
    clientPortfolio(repId, period),
    revenueByRep(period.from, period.to, repId),
    receivableRowsByRep(repId),
    returnsByClient(period.from, period.to, repId, RETURN_CLIENTS),
  ]);

  const aging = sumAging(receivables);
  const totals = revenue[0];
  const round = (n: number) => Math.round(n);

  // Оборот у підсумку вже нетто, тож частку рахуємо від валу — інакше
  // при поверненнях, більших за продажі, вийшло б понад 100%.
  const netto = round(totals?.amount ?? 0);
  const returned = round(totals?.returns ?? 0);
  const gross = netto + returned;

  const byState = (state: string) =>
    portfolio.clients
      .filter((c) => c.state === state)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, CLIENTS_PER_STATE)
      .map((c) => ({
        клієнт: c.name,
        оборот: round(c.amount),
        днів_без_замовлень: c.daysSinceLast,
        звичний_ритм_днів: round(c.avgIntervalDays),
        позицій: c.skuCount,
        борг: round(c.receivable),
      }));

  return {
    торговий: repName ?? "—",
    період: { від: period.fromDay, до: period.toDay, днів: period.days },
    підсумок: {
      оборот: netto,
      реалізацій: totals?.docs ?? 0,
      клієнтів_у_періоді: totals?.clients ?? 0,
      середній_чек: totals && totals.docs > 0 ? round(totals.amount / totals.docs) : 0,
    },
    повернення: {
      сума: returned,
      оборот_до_повернень: gross,
      частка_від_обороту_відсотків: gross > 0 ? round((returned / gross) * 100) : 0,
      по_клієнтах: returnClients.map((c) => ({
        клієнт: c.clientName ?? "—",
        сума: round(c.amount),
        документів: c.docs,
      })),
    },
    темп: trend.momentum.comparable
      ? {
          // Межі вікон датами: модель зобов'язана вказувати в кожному
          // інсайті, ЩО з ЧИМ порівняно, і дати мусить брати звідси
          // дослівно, а не вигадувати.
          вікно_останніх_4_тижнів: { від: trend.momentum.recentFrom, до: period.toDay },
          вікно_попередніх_4_тижнів: {
            від: trend.momentum.previousFrom,
            до: dayBefore(trend.momentum.recentFrom),
          },
          останні_4_тижні: {
            оборот: round(trend.momentum.recent.amount),
            реалізацій: trend.momentum.recent.docs,
            середній_чек: round(trend.momentum.recent.avgCheck),
            клієнтів: trend.momentum.recent.clients,
          },
          попередні_4_тижні: {
            оборот: round(trend.momentum.previous.amount),
            реалізацій: trend.momentum.previous.docs,
            середній_чек: round(trend.momentum.previous.avgCheck),
            клієнтів: trend.momentum.previous.clients,
          },
          зміна_обороту_відсотків: round(trend.momentum.amountDeltaPct),
          зміна_реалізацій_відсотків: round(trend.momentum.docsDeltaPct),
          зміна_чека_відсотків: round(trend.momentum.avgCheckDeltaPct),
          зміна_клієнтів_відсотків: round(trend.momentum.clientsDeltaPct),
        }
      : "порівнювати нема з чим — історія коротша за два вікна",
    по_місяцях: trend.monthly.map((m) => ({
      місяць: m.bucket.slice(0, 7),
      оборот: round(m.amount),
      реалізацій: m.docs,
      клієнтів: m.clients,
      середній_чек: round(m.avgCheck),
    })),
    по_тижнях: trend.weekly.map((w) => ({
      тиждень: w.bucket,
      оборот: round(w.amount),
      реалізацій: w.docs,
    })),
    портфель_клієнтів: {
      усього: portfolio.totalClients,
      за_станами: portfolio.counts,
      оборот_нових: round(portfolio.newRevenue),
      оборот_втрачених: round(portfolio.lostRevenue),
      нові: byState("NEW"),
      збиваються_з_ритму: byState("SLIPPING"),
      сплять: byState("DORMANT"),
      втрачені: byState("LOST"),
    },
    дебіторка: {
      усього: round(aging.total),
      прострочено: round(aging.overdue),
      частка_простроченої_відсотків: round(aging.overdueRatio),
    },
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ repId: string }> }) {
  const { repId } = await params;
  const checked = await guard(req, repId);
  if ("error" in checked) return checked.error;

  const { period } = checked;
  const cached = await readReport("rep", repId, period.fromDay, period.toDay);

  return NextResponse.json({
    configured: insightsConfigured(),
    report: cached,
    period: { from: period.fromDay, to: period.toDay },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ repId: string }> }) {
  const { repId } = await params;
  const checked = await guard(req, repId);
  if ("error" in checked) return checked.error;

  if (!insightsConfigured()) {
    return NextResponse.json(
      { error: "АІ-аналіз не налаштований: бракує ANTHROPIC_API_KEY" },
      { status: 503 }
    );
  }

  const { rep, period } = checked;
  const facts = await buildFacts(repId, rep.name, period);

  // Без продажів немає про що робити висновки — модель тут не потрібна.
  // Але період із самими поверненнями порожнім не вважаємо: нуль продажів
  // при поверненнях на пів мільйона — це якраз те, що треба показати.
  if (facts.підсумок.реалізацій === 0 && facts.повернення.сума === 0) {
    return NextResponse.json({
      configured: true,
      report: {
        insights: [],
        facts,
        model: "",
        tokens: 0,
        generatedAt: new Date().toISOString(),
        fresh: true,
      },
      empty: "За обраний період у цього торгового немає жодної реалізації.",
    });
  }

  let result;
  try {
    result = await generateInsights({
      kind: "rep",
      facts,
      scopeNote: `Дані охоплюють одного торгового: ${rep.name ?? "—"}.`,
    });
  } catch (e) {
    console.error("insights rep", e);
    return NextResponse.json(
      { error: `Модель не відповіла: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  const generatedAt = await writeReport({
    kind: "rep",
    repId,
    fromDay: period.fromDay,
    toDay: period.toDay,
    insights: result.insights,
    facts,
    model: result.model,
    tokens: result.tokens,
  });

  return NextResponse.json({
    configured: true,
    report: {
      insights: result.insights,
      facts,
      model: result.model,
      tokens: result.tokens,
      generatedAt,
      fresh: true,
    },
    rejected: result.rejected,
  });
}
