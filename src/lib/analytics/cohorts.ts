/**
 * Когорти утримання і відтік у грошах: чи приживаються нові клієнти
 * і скільки коштують ті, що пішли.
 *
 * Когорта — місяць першої реалізації клієнта. Для кожної когорти видно,
 * яка частка клієнтів купувала в наступні місяці. Якщо з когорти лютого
 * до травня доживає 30% — проблема не в пошуку клієнтів, а в утриманні,
 * і це інша розмова з торговими.
 *
 * ВАЖЛИВЕ ЗАСТЕРЕЖЕННЯ ПРО ПЕРШУ КОГОРТУ: історія реалізацій починається
 * з січня 2026, тож клієнти «першої покупки в січні» — це вся стара база
 * разом зі справді новими. Січнева когорта позначена як стартова і в
 * висновках про «нових» участі не бере.
 *
 * Відтік у грошах — друга половина модуля: скільки давали на місяць
 * клієнти, які зараз у станах LOST і DORMANT. Пороги станів — ті самі
 * константи, що в портфелі клієнтів (clients.ts), щоб «втрачений» тут
 * і там означало одне й те саме.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { DORMANT_DAYS, LOST_DAYS } from "@/lib/analytics/clients";

/**
 * Мінімум документів, щоб рахувати клієнта в відтоку, — той самий, що
 * MIN_DOCS_FOR_LOST у clients.ts (він не експортований, а значення
 * навмисно однакове: разова покупка — не втрачений клієнт).
 */
const MIN_DOCS_FOR_CHURN = 2;

const DAY_MS = 86_400_000;

export type CohortRow = {
  /** "2026-02" */
  month: string;
  /** true — стартова база, а не справді нові клієнти. */
  isBaseline: boolean;
  size: number;
  /** Оборот когорти в перший місяць. */
  firstMonthRevenue: number;
  /** Оборот когорти за весь час. */
  totalRevenue: number;
  /**
   * activity[k] — частка клієнтів когорти (%), що мали реалізацію через
   * k місяців після першої покупки. activity[0] завжди 100.
   */
  activity: number[];
  /** Частка когорти, активна в ОСТАННІЙ повний місяць (грубий «вижив»). */
  aliveShare: number;
};

export type ChurnedClient = {
  counterpartyId: string;
  name: string;
  repId: string | null;
  repName: string | null;
  state: "LOST" | "DORMANT";
  lastDocAt: string;
  daysSinceLast: number;
  /** Середній оборот на місяць, поки клієнт був живий. */
  avgMonthly: number;
  totalRevenue: number;
  docs: number;
  /**
   * true — уся історія клієнта вклалася менш ніж у місяць (разова
   * закупівля під обʼєкт, а не постійний ритм). Для таких avgMonthly
   * дорівнює всій сумі покупок, і в інтерфейсі це треба підписати:
   * інакше сплеск на 476 тис. за тиждень читався б як щомісячна втрата.
   */
  oneOff: boolean;
};

export type CohortReport = {
  months: string[];
  cohorts: CohortRow[];
  churn: {
    lost: ChurnBucket;
    dormant: ChurnBucket;
    top: ChurnedClient[];
  };
};

export type ChurnBucket = {
  clients: number;
  /**
   * Сумарний місячний оборот РЕГУЛЯРНИХ клієнтів (історія довша за
   * місяць). Саме це число можна показувати як «стільки втрачаємо
   * щомісяця».
   */
  monthlyRevenue: number;
  /** Скільки з них — разові закупівлі, і на яку суму загалом. */
  oneOffClients: number;
  oneOffRevenue: number;
};

type FirstBuyRow = {
  counterpartyId: string;
  firstMonth: string;
  months: string[];
  total: number;
  firstMonthRevenue: number;
};

type ChurnRow = {
  counterpartyId: string;
  name: string;
  repId: string | null;
  lastDocAt: Date;
  firstDocAt: Date;
  docs: number;
  total: number;
};

/** Різниця в місяцях між "YYYY-MM". */
function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export async function buildCohortReport(topChurnLimit = 30): Promise<CohortReport> {
  const [firstBuys, churnRows, reps] = await Promise.all([
    // Місяці активності кожного клієнта одним запитом: перший місяць —
    // когорта, решта — чи «дожив». Місяці за Києвом, як і вся аналітика.
    prisma.$queryRaw<FirstBuyRow[]>`
      WITH activity AS (
        SELECT
          s."counterpartyId",
          to_char(date_trunc('month', s."createdAt" AT TIME ZONE 'Europe/Kyiv'), 'YYYY-MM') AS m,
          SUM(s."totalAmount")::float AS amount
        FROM "SalesDocument" s
        WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
          AND s."docType" IN ('REALIZATION', 'RETURN')
          AND s."counterpartyId" IS NOT NULL
        GROUP BY 1, 2
        -- Місяць «активний», лише якщо в ньому були самі покупки, а не
        -- голе повернення: нетто > 0.
        HAVING SUM(s."totalAmount") FILTER (WHERE s."docType" = 'REALIZATION') > 0
      )
      SELECT
        "counterpartyId",
        MIN(m) AS "firstMonth",
        array_agg(m ORDER BY m) AS months,
        SUM(amount)::float AS total,
        (array_agg(amount ORDER BY m))[1]::float AS "firstMonthRevenue"
      FROM activity
      GROUP BY "counterpartyId"
    `,
    prisma.$queryRaw<ChurnRow[]>`
      SELECT
        s."counterpartyId",
        c.name,
        COALESCE(
          (SELECT src."salesRepId" FROM "SalesRepClient" src
           WHERE src."counterpartyId" = s."counterpartyId" ORDER BY src.id LIMIT 1),
          (SELECT sd."salesRepId" FROM "SalesDocument" sd
           WHERE sd."counterpartyId" = s."counterpartyId"
             AND sd."salesRepId" IS NOT NULL AND sd."docType" <> 'RETURN'
           ORDER BY (sd."docType" = 'REALIZATION') DESC, sd."createdAt" DESC LIMIT 1)
        ) AS "repId",
        MAX(s."createdAt") FILTER (WHERE s."docType" = 'REALIZATION') AS "lastDocAt",
        MIN(s."createdAt") FILTER (WHERE s."docType" = 'REALIZATION') AS "firstDocAt",
        COUNT(*) FILTER (WHERE s."docType" = 'REALIZATION')::int AS docs,
        SUM(s."totalAmount")::float AS total
      FROM "SalesDocument" s
      JOIN "Counterparty" c ON c.id = s."counterpartyId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" IN ('REALIZATION', 'RETURN')
        AND s."counterpartyId" IS NOT NULL
      GROUP BY s."counterpartyId", c.name
      HAVING COUNT(*) FILTER (WHERE s."docType" = 'REALIZATION') >= ${MIN_DOCS_FOR_CHURN}
    `,
    prisma.user.findMany({ where: { role: "SALES" }, select: { id: true, name: true } }),
  ]);

  // ---- Когорти ----

  const currentMonth = kyivDate(new Date()).slice(0, 7);
  const allMonths = [...new Set(firstBuys.map((r) => r.firstMonth))].sort();
  const firstMonth = allMonths[0];

  const byCohort = new Map<string, FirstBuyRow[]>();
  for (const r of firstBuys) {
    const list = byCohort.get(r.firstMonth) ?? [];
    list.push(r);
    byCohort.set(r.firstMonth, list);
  }

  // Останній ПОВНИЙ місяць: поточний ще триває, і «частка живих» по ньому
  // занижувала б усі когорти тим сильніше, чим раніше число місяця.
  const lastFullMonth =
    currentMonth > firstMonth
      ? `${currentMonth}-01` <= kyivDate(new Date())
        ? (() => {
            const [y, m] = currentMonth.split("-").map(Number);
            const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
            return prev;
          })()
        : currentMonth
      : currentMonth;

  const cohorts: CohortRow[] = [...byCohort.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, members]) => {
      const horizon = monthDiff(month, currentMonth) + 1;
      const activity: number[] = [];
      for (let k = 0; k < horizon; k++) {
        const [y, m] = month.split("-").map(Number);
        const target = `${y + Math.floor((m - 1 + k) / 12)}-${String(((m - 1 + k) % 12) + 1).padStart(2, "0")}`;
        const active = members.filter((r) => r.months.includes(target)).length;
        activity.push((active / members.length) * 100);
      }

      const alive =
        lastFullMonth >= month
          ? members.filter((r) => r.months.includes(lastFullMonth)).length
          : members.length;

      return {
        month,
        isBaseline: month === firstMonth,
        size: members.length,
        firstMonthRevenue: members.reduce((s, r) => s + r.firstMonthRevenue, 0),
        totalRevenue: members.reduce((s, r) => s + r.total, 0),
        activity,
        aliveShare: (alive / members.length) * 100,
      };
    });

  // ---- Відтік у грошах ----

  const repName = new Map(reps.map((r) => [r.id, r.name]));
  const now = Date.now();

  const churned: ChurnedClient[] = [];
  for (const r of churnRows) {
    if (!r.lastDocAt || !r.firstDocAt) continue;
    const daysSinceLast = Math.floor((now - r.lastDocAt.getTime()) / DAY_MS);
    if (daysSinceLast < DORMANT_DAYS) continue;

    const state: ChurnedClient["state"] = daysSinceLast >= LOST_DAYS ? "LOST" : "DORMANT";

    // Середньомісячний оборот за ЖИВИЙ період клієнта — від першої до
    // останньої покупки. Ділити на весь календар було б нечесно: клієнт,
    // що пішов пів року тому, виглядав би вдвічі дрібнішим, ніж був.
    //
    // Знаменник не менший за місяць, і це не формальність: клієнт, який
    // узяв 476 тис. трьома накладними за ТИЖДЕНЬ, при чесному діленні дав
    // би «2 млн/міс» і очолив би список утрат — хоча насправді це разова
    // закупівля під обʼєкт, а не місячний ритм. Місяць у знаменнику
    // прирівнює такий сплеск до «стільки він дав за раз».
    const spanMonths = (r.lastDocAt.getTime() - r.firstDocAt.getTime()) / DAY_MS / 30;
    const aliveMonths = Math.max(1, spanMonths);

    churned.push({
      oneOff: spanMonths < 1,
      counterpartyId: r.counterpartyId,
      name: r.name,
      repId: r.repId,
      repName: r.repId ? (repName.get(r.repId) ?? null) : null,
      state,
      lastDocAt: r.lastDocAt.toISOString(),
      daysSinceLast,
      avgMonthly: r.total / aliveMonths,
      totalRevenue: r.total,
      docs: r.docs,
    });
  }

  churned.sort((a, b) => b.avgMonthly - a.avgMonthly);

  // Разові закупівлі рахуються окремо: їхній «місячний оборот» — це сума
  // однієї угоди, і змішувати її з ритмом постійних клієнтів означало б
  // роздути втрати в рази (на серпень 2026 — 2,5 млн проти реальних ~600 тис.).
  const bucket = (state: ChurnedClient["state"]): ChurnBucket => {
    const all = churned.filter((c) => c.state === state);
    const regular = all.filter((c) => !c.oneOff);
    const oneOff = all.filter((c) => c.oneOff);
    return {
      clients: all.length,
      monthlyRevenue: regular.reduce((s, c) => s + c.avgMonthly, 0),
      oneOffClients: oneOff.length,
      oneOffRevenue: oneOff.reduce((s, c) => s + c.totalRevenue, 0),
    };
  };

  return {
    months: allMonths,
    cohorts,
    churn: {
      lost: bucket("LOST"),
      dormant: bucket("DORMANT"),
      top: churned.slice(0, topChurnLimit),
    },
  };
}
