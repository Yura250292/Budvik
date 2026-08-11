/**
 * Бенчмарк команди: хто де сильний, хто де провисає.
 *
 * Зведена вкладка вже показує оборот кожного — але з неї не видно
 * головного: оборот 400 тис. це багато чи мало? Відповідь залежить від
 * решти команди. Тут кожна метрика перекладається в перцентиль по
 * команді, і замість «400 тис.» керівник бачить «третій з одинадцяти».
 *
 * ЧОМУ ПЕРЦЕНТИЛІ, А НЕ Z-SCORE. Торгових одинадцять, і розподіл у них не
 * нормальний: один сильний продавець з оборотом удвічі більшим за решту
 * роздуває σ так, що всі інші опиняються «в межах норми» і жодного
 * відставання не видно. Перцентиль стійкий до викидів і читається без
 * пояснень.
 *
 * Усі числа беруться з наявних шарів фактів (facts, money-facts, trends,
 * clients) — тут лише зведення й ранжування, жодного власного SQL по
 * продажах. Інакше «оборот» у бенчмарку колись розійшовся б із оборотом
 * у зведеній.
 *
 * ЧОГО ТУТ СВІДОМО НЕМАЄ — відсотка «зібрано від відвантаженого». Оплати
 * приходять за старі відвантаження, тож ділити зібране за період на
 * оборот за той самий період безглуздо: на живих даних це дало 6833% у
 * торгового з малим оборотом і великими старими надходженнями. Ранжуємо
 * зібрані гроші в гривнях; співвідношення лишається на картці людини, де
 * поруч видно контекст.
 */

import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/analytics/period";
import { revenueByRep, revenueByRepBrand, SOURCE_FILTER, SALES_ONLY } from "@/lib/analytics/facts";
import {
  collectedByRepBrand,
  collectedTotals,
  receivableRowsByRep,
  agingByRep,
} from "@/lib/analytics/money-facts";
import { momentumByRep } from "@/lib/analytics/trends";
import { portfolioCountsByRep } from "@/lib/analytics/clients";

/**
 * Метрики, які ранжуються.
 *
 * `higherIsBetter` — бік, з якого перцентиль вважається сильним. Для
 * простроченої дебіторки й для втрачених клієнтів більше означає гірше,
 * і без цього прапорця найгірший торговий потрапляв би в «сильні
 * сторони».
 *
 * Самі дані лежать у `benchmarkMetrics.ts`, щоб клієнтські компоненти
 * брали їх звідти й не тягнули за собою Prisma. Тут — лише реекспорт
 * для серверного коду.
 */
import { METRICS, type MetricKey } from "@/lib/analytics/benchmarkMetrics";

export { METRICS, type MetricKey };

/** Перцентиль, з якого метрика вважається сильною / слабкою стороною. */
export const STRONG_PERCENTILE = 75;
export const WEAK_PERCENTILE = 25;

/**
 * Мінімум людей, щоб порівняння взагалі мало сенс.
 *
 * На двох торгових перцентиль вироджується: один завжди 100, другий 0, і
 * будь-яка метрика читається як «катастрофа проти зірки».
 */
export const MIN_TEAM_SIZE = 4;

/**
 * null означає «метрику порахувати нема з чого» — на відміну від 0, який
 * означає справжній нуль. Для динаміки це критично: торговий без історії
 * і торговий, що втримав торішній рівень, — це не одне й те саме, а нуль
 * зробив би їх однаковими і в таблиці, і в ранжуванні.
 */
export type RepMetrics = { repId: string; name: string } & Record<MetricKey, number | null>;

export type Benchmarked = RepMetrics & {
  /** 0..100 по кожній метриці; null — метрика не ранжується (немає даних) */
  ranks: Record<MetricKey, number | null>;
  /** Місце в команді за оборотом, 1 — найкращий */
  place: number;
  strengths: MetricKey[];
  weaknesses: MetricKey[];
};

export type BrandMatrixRow = {
  brandId: string | null;
  brandName: string;
  /** repId → оборот бренду в цього торгового */
  byRep: Record<string, number>;
  total: number;
  /** Частка торгових, у кого бренд ненульовий, 0..1 */
  coverage: number;
  /** Хто взагалі не продає цей бренд, хоча решта продає */
  missingRepIds: string[];
};

export type TeamBenchmark = {
  period: { from: string; to: string; days: number };
  reps: Benchmarked[];
  /** null — метрику не порахувати в жодного торгового */
  medians: Record<MetricKey, number | null>;
  brandMatrix: BrandMatrixRow[];
  /** false — команда замала, перцентилі не показуємо */
  comparable: boolean;
};

/**
 * Перцентиль значення у вибірці.
 *
 * Частка тих, хто гірший, — тобто найкращий отримує 100, найгірший 0.
 * Однакові значення отримують однаковий перцентиль: два торгових з нулем
 * нових клієнтів мають бути рівні, а не випадково розставлені порядком
 * рядків.
 */
function percentile(value: number, values: number[], higherIsBetter: boolean): number {
  if (values.length < 2) return 50;
  const worse = values.filter((v) => (higherIsBetter ? v < value : v > value)).length;
  const same = values.filter((v) => v === value).length;
  // Половина однакових зараховується як «гірші» — інакше при трьох
  // однакових нулях усі троє отримали б 0, ніби вони найгірші за себе.
  return ((worse + same / 2) / values.length) * 100;
}

/**
 * Мінімальна база попереднього вікна, щоб відсоток зміни щось означав.
 *
 * На живих даних торговий із 4 тис. ₴ у попередньому вікні показав
 * «+4748%», піднявшись до 200 тис. — і в рейтингу динаміки обійшов усіх,
 * хто справді росте. Відсоток від майже нуля вимірює не темп, а те, що
 * бази не було.
 */
export const MOMENTUM_MIN_BASE = 50_000;

function usableMomentum(m: { comparable: boolean; previous: { amount: number } } | undefined): boolean {
  return !!m && m.comparable && m.previous.amount >= MOMENTUM_MIN_BASE;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Ширина асортименту: скільки різних SKU торговий продав і скільком клієнтам.
 *
 * Це лічильники, а не гроші, тому повернення сюди не входять зовсім
 * (SALES_ONLY): повернений товар не робить SKU «пропрацьованим», а клієнта —
 * охопленим.
 */
async function assortmentByRep(period: Period) {
  return prisma.$queryRaw<Array<{ repId: string; skus: number; clients: number }>>`
    SELECT
      s."salesRepId" AS "repId",
      COUNT(DISTINCT i."productId")::int      AS skus,
      COUNT(DISTINCT s."counterpartyId")::int AS clients
    FROM "SalesDocument" s
    JOIN "SalesDocumentItem" i ON i."salesDocumentId" = s.id
    WHERE ${SOURCE_FILTER}
      AND ${SALES_ONLY}
      AND s."salesRepId" IS NOT NULL
      AND s."createdAt" >= ${period.from} AND s."createdAt" <= ${period.to}
    GROUP BY 1
  `;
}

/** Зведення по команді з перцентилями, медіанами й матрицею брендів. */
export async function teamBenchmark(period: Period): Promise<TeamBenchmark> {
  const [revenue, brandRows, collected, receivables, momentum, portfolio, assortment, users] =
    await Promise.all([
      revenueByRep(period.from, period.to),
      revenueByRepBrand(period.from, period.to),
      collectedByRepBrand(period.from, period.to),
      receivableRowsByRep(),
      momentumByRep(period),
      portfolioCountsByRep(period),
      assortmentByRep(period),
      prisma.user.findMany({
        where: { role: "SALES" },
        select: { id: true, name: true },
      }),
    ]);

  const collectedMap = collectedTotals(collected);
  const agingMap = agingByRep(receivables);
  const assortmentMap = new Map(assortment.map((a) => [a.repId, a]));
  const nameMap = new Map(users.map((u) => [u.id, u.name ?? "—"]));

  // Бренди рахуємо на людину окремо: revenueByRepBrand дає рядок на пару,
  // а нам треба «скільки різних брендів у цього торгового».
  const brandsPerRep = new Map<string, Set<string>>();
  for (const row of brandRows) {
    if (!row.brandId || row.amount <= 0) continue;
    const set = brandsPerRep.get(row.repId) ?? new Set<string>();
    set.add(row.brandId);
    brandsPerRep.set(row.repId, set);
  }

  // База — ті, хто мав продажі в періоді. Торговий без жодної реалізації
  // у порівняння не потрапляє: його нулі зсунули б медіану всієї команди
  // вниз і зробили б решту «сильнішою», ніж вона є.
  const metrics: RepMetrics[] = revenue.map((r) => {
    const rep = r.repId;
    const money = collectedMap.get(rep) ?? { amount: 0, profit: 0 };
    const aging = agingMap.get(rep);
    const counts = portfolio.get(rep);
    const assort = assortmentMap.get(rep);
    const mom = momentum.get(rep);

    return {
      repId: rep,
      name: nameMap.get(rep) ?? "—",
      revenue: r.amount,
      docs: r.docs,
      clients: r.clients,
      avgCheck: r.docs > 0 ? r.amount / r.docs : 0,
      collected: money.amount,
      overdueRatio: aging?.overdueRatio ?? 0,
      skuPerClient: assort && assort.clients > 0 ? assort.skus / assort.clients : 0,
      brandCount: brandsPerRep.get(rep)?.size ?? 0,
      newClients: counts?.newClients ?? 0,
      lostClients: counts?.lostClients ?? 0,
      // null, а не 0: «немає з чим порівнювати» ≠ «не змінилося».
      momentumPct: usableMomentum(mom) ? mom!.amountDeltaPct : null,
    };
  });

  const keys = Object.keys(METRICS) as MetricKey[];
  const comparable = metrics.length >= MIN_TEAM_SIZE;

  // Порівнюємо лише наявні значення: якщо в половини команди метрику
  // порахувати нема з чого, решта має ранжуватися між собою, а не проти
  // вигаданих нулів.
  const columns = new Map<MetricKey, number[]>();
  const medians = {} as Record<MetricKey, number | null>;
  for (const key of keys) {
    const values = metrics.map((m) => m[key]).filter((v): v is number => v !== null);
    columns.set(key, values);
    medians[key] = values.length > 0 ? median(values) : null;
  }

  const byRevenue = [...metrics].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const placeMap = new Map(byRevenue.map((m, i) => [m.repId, i + 1]));

  const reps: Benchmarked[] = metrics.map((m) => {
    const ranks = {} as Record<MetricKey, number | null>;
    const strengths: MetricKey[] = [];
    const weaknesses: MetricKey[] = [];

    for (const key of keys) {
      const value = m[key];
      const values = columns.get(key)!;
      // Метрика без значення не ранжується — і не потрапляє ні в сильні,
      // ні в слабкі сторони.
      if (!comparable || value === null || values.length < 2) {
        ranks[key] = null;
        continue;
      }
      const rank = percentile(value, values, METRICS[key].higherIsBetter);
      ranks[key] = rank;
      if (rank >= STRONG_PERCENTILE) strengths.push(key);
      else if (rank <= WEAK_PERCENTILE) weaknesses.push(key);
    }

    return {
      ...m,
      ranks,
      place: placeMap.get(m.repId) ?? 0,
      strengths,
      weaknesses,
    };
  });

  reps.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));

  return {
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    reps,
    medians,
    brandMatrix: buildBrandMatrix(brandRows, metrics),
    comparable,
  };
}

/**
 * Матриця бренд × торговий.
 *
 * Головне, заради чого вона потрібна, — порожні клітинки: бренд, який
 * возить уся команда, а хтось один не продає жодної одиниці. Це не
 * «слабкий торговий», а конкретна тема для розмови.
 *
 * Бренди без назви («Без бренду») у матрицю не йдуть: це технічний
 * залишок нерозпізнаної номенклатури, а не привід дорікати комусь
 * покриттям.
 */
function buildBrandMatrix(
  rows: Awaited<ReturnType<typeof revenueByRepBrand>>,
  metrics: RepMetrics[]
): BrandMatrixRow[] {
  const repIds = metrics.map((m) => m.repId);
  const byBrand = new Map<string, BrandMatrixRow>();

  for (const row of rows) {
    if (!row.brandId) continue;
    const entry =
      byBrand.get(row.brandId) ??
      {
        brandId: row.brandId,
        brandName: row.brandName ?? "—",
        byRep: {} as Record<string, number>,
        total: 0,
        coverage: 0,
        missingRepIds: [],
      };
    entry.byRep[row.repId] = (entry.byRep[row.repId] ?? 0) + row.amount;
    entry.total += row.amount;
    byBrand.set(row.brandId, entry);
  }

  const matrix = Array.from(byBrand.values());
  for (const entry of matrix) {
    const selling = repIds.filter((id) => (entry.byRep[id] ?? 0) > 0);
    entry.coverage = repIds.length > 0 ? selling.length / repIds.length : 0;
    entry.missingRepIds = repIds.filter((id) => (entry.byRep[id] ?? 0) <= 0);
  }

  return matrix.sort((a, b) => b.total - a.total);
}
