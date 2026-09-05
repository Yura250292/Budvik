/**
 * АІ-інсайти по всій команді. ЗАСТАРІЛЕ: інтерфейс сюди більше не звертається.
 *
 * Командний аналіз переїхав у розділ «AI аналіз фірми» (вкладка «Торгові»):
 * там та сама команда описується разом із чеклістом дзвінків по клієнтах і
 * переходами в дані, тож панель у «Порівнянні» лишилася дублем, за який
 * платили токенами вдруге.
 *
 * Роут не видалено, бо в архіві (SavedAiReport) лежать звіти з kind="team",
 * і фільтр «По команді» має їх відкривати. Видалення роуту саме по собі їх
 * не зламає, але тримати парний до них код дешевше, ніж потім згадувати,
 * звідки вони взялися. Нових звітів цього виду більше не з'являється.
 *
 * Лише для керівництва — як і сам бенчмарк.
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
  const { searchParams } = new URL(req.url);
  // ?reps=id1,id2 — аналіз лише обраних торгових.
  const repsParam = searchParams.get("reps");
  const onlyReps = repsParam
    ? repsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50)
    : undefined;
  return { period: parsePeriod(searchParams), onlyReps };
}

/**
 * Зведення для моделі.
 *
 * Метрики підписані українською тими самими назвами, що в таблиці, — щоб
 * інсайт і колонка, на яку він посилається, називалися однаково.
 */
async function buildFacts(period: ReturnType<typeof parsePeriod>, onlyReps?: string[]) {
  const bench = await teamBenchmark(period, onlyReps);
  const keys = Object.keys(METRICS) as MetricKey[];
  const round = (n: number | null) => (n === null ? null : Math.round(n));

  const reps = bench.reps.map((rep) => {
    const показники: Record<string, number | null> = {};
    const позаду_відсотків_команди: Record<string, number | null> = {};
    for (const key of keys) {
      показники[METRICS[key].label] = round(rep[key]);
      позаду_відсотків_команди[METRICS[key].label] = round(rep.ranks[key]);
    }
    return {
      торговий: rep.name,
      місце_за_оборотом: rep.place,
      показники,
      позаду_відсотків_команди,
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
    // Керівник міг звузити порівняння галочками — модель мусить розуміти,
    // що це не вся команда, і не робити висновків про відсутніх.
    вибірка:
      onlyReps && onlyReps.length > 0
        ? `порівнюються лише обрані керівником ${bench.reps.length} із ${bench.roster.length} торгових; місця й медіани пораховані всередині вибірки`
        : "уся команда з продажами за період",
    порівняння_можливе: bench.comparable,
    команда: reps,
    медіани_команди: медіани,
    прогалини_по_брендах: прогалини,
  };
}

export async function GET(req: NextRequest) {
  const checked = await guard(req);
  if ("error" in checked) return checked.error;

  const { period, onlyReps } = checked;

  // Кеш живе лише для повної команди: його ключ — (kind, період), і звіт
  // по трьох обраних затер би там звіт по всіх. Для вибірки кешу немає —
  // аналіз завжди генерується явно.
  const cached = onlyReps ? null : await readReport("team", null, period.fromDay, period.toDay);

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

  const { period, onlyReps } = checked;
  const facts = await buildFacts(period, onlyReps);

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
      empty: onlyReps
        ? "Ніхто з обраних торгових не має реалізацій за період."
        : "За обраний період жоден торговий не має реалізацій.",
    });
  }

  let result;
  try {
    result = await generateInsights({
      kind: "team",
      facts,
      scopeNote: onlyReps
        ? `Дані охоплюють ${facts.торгових_у_порівнянні} торгових, ОБРАНИХ керівником для порівняння (не всю команду).`
        : `Дані охоплюють усіх торгових компанії (${facts.торгових_у_порівнянні} осіб із продажами за період).`,
    });
  } catch (e) {
    console.error("insights team", e);
    return NextResponse.json(
      { error: `Модель не відповіла: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  // Звіт по вибірці в кеш не пишемо — ключ (kind, період) один, і вибірка
  // затерла б звіт по всій команді. Зберегти його в архів однаково можна.
  const generatedAt = onlyReps
    ? new Date().toISOString()
    : await writeReport({
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
