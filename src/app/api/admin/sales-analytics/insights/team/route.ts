/**
 * АІ-інсайти по всій команді.
 *
 * Лише для керівництва — як і сам бенчмарк: рейтинг колег це інструмент
 * керівника, а не привід для змагання в чаті.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { teamBenchmark, METRICS, type MetricKey } from "@/lib/analytics/benchmark";
import { MOMENTUM_WEEKS } from "@/lib/analytics/trends";
import { generateInsights, insightsConfigured } from "@/lib/ai/insights";
import { readReport, writeReport } from "@/lib/ai/insight-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

/** Скільки брендів із неповним покриттям показувати моделі. */
const BRAND_GAPS_LIMIT = 12;

async function guard(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Не авторизовано" }, { status: 401 }) };
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return { error: NextResponse.json({ error: "Немає доступу" }, { status: 403 }) };
  }
  return { period: parsePeriod(new URL(req.url).searchParams) };
}

/**
 * Зведення для моделі.
 *
 * Метрики підписані українською тими самими назвами, що в таблиці, — щоб
 * інсайт і колонка, на яку він посилається, називалися однаково.
 */
async function buildFacts(period: ReturnType<typeof parsePeriod>) {
  const bench = await teamBenchmark(period);
  const keys = Object.keys(METRICS) as MetricKey[];
  const round = (n: number | null) => (n === null ? null : Math.round(n));

  const reps = bench.reps.map((rep) => {
    const показники: Record<string, number | null> = {};
    const перцентилі: Record<string, number | null> = {};
    for (const key of keys) {
      показники[METRICS[key].label] = round(rep[key]);
      перцентилі[METRICS[key].label] = round(rep.ranks[key]);
    }
    return {
      торговий: rep.name,
      місце_за_оборотом: rep.place,
      показники,
      перцентилі,
      сильні_сторони: rep.strengths.map((k) => METRICS[k].label),
      слабкі_сторони: rep.weaknesses.map((k) => METRICS[k].label),
    };
  });

  const медіани: Record<string, number | null> = {};
  for (const key of keys) медіани[METRICS[key].label] = round(bench.medians[key]);

  // Межі вікон метрики «Темп %» — та сама формула, що в trends.ts:
  // останні 4 тижні від кінця періоду проти попередніх 4. Модель мусить
  // указувати в інсайтах, що з чим порівняно, і дати бере звідси.
  const DAY_MS = 86_400_000;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const recentFrom = new Date(period.to.getTime() - MOMENTUM_WEEKS * 7 * DAY_MS);
  const previousFrom = new Date(period.to.getTime() - 2 * MOMENTUM_WEEKS * 7 * DAY_MS);

  const nameById = new Map(bench.reps.map((r) => [r.repId, r.name]));

  // Лише бренди з прогалинами: повне покриття не потребує розмови.
  const прогалини = bench.brandMatrix
    .filter((b) => b.coverage > 0 && b.coverage < 1 && b.missingRepIds.length > 0)
    .slice(0, BRAND_GAPS_LIMIT)
    .map((b) => ({
      бренд: b.brandName,
      оборот_бренду: Math.round(b.total),
      покриття_відсотків: Math.round(b.coverage * 100),
      не_продають: b.missingRepIds.map((id) => nameById.get(id) ?? "—"),
    }));

  return {
    період: { від: period.fromDay, до: period.toDay, днів: period.days },
    вікна_метрики_темп: {
      пояснення: "«Темп %» — оборот за останні 4 тижні проти попередніх 4",
      останні_4_тижні: { від: day(recentFrom), до: period.toDay },
      попередні_4_тижні: {
        від: day(previousFrom),
        до: day(new Date(recentFrom.getTime() - DAY_MS)),
      },
    },
    торгових_у_порівнянні: bench.reps.length,
    порівняння_можливе: bench.comparable,
    команда: reps,
    медіани_команди: медіани,
    прогалини_по_брендах: прогалини,
  };
}

export async function GET(req: NextRequest) {
  const checked = await guard(req);
  if ("error" in checked) return checked.error;

  const { period } = checked;
  const cached = await readReport("team", null, period.fromDay, period.toDay);

  return NextResponse.json({
    configured: insightsConfigured(),
    report: cached,
    period: { from: period.fromDay, to: period.toDay },
  });
}

export async function POST(req: NextRequest) {
  const checked = await guard(req);
  if ("error" in checked) return checked.error;

  if (!insightsConfigured()) {
    return NextResponse.json(
      { error: "АІ-аналіз не налаштований: бракує ANTHROPIC_API_KEY" },
      { status: 503 }
    );
  }

  const { period } = checked;
  const facts = await buildFacts(period);

  if (facts.торгових_у_порівнянні === 0) {
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
      empty: "За обраний період жоден торговий не має реалізацій.",
    });
  }

  let result;
  try {
    result = await generateInsights({
      kind: "team",
      facts,
      scopeNote: `Дані охоплюють усіх торгових компанії (${facts.торгових_у_порівнянні} осіб із продажами за період).`,
    });
  } catch (e) {
    console.error("insights team", e);
    return NextResponse.json(
      { error: `Модель не відповіла: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  const generatedAt = await writeReport({
    kind: "team",
    repId: null,
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
