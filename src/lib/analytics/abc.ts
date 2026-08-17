/**
 * ABC/XYZ-аналіз: що приносить гроші і на що можна покластися.
 *
 * Два незалежні виміри, які закупівельник і керівник читають разом:
 *
 *   ABC — внесок в оборот. Класика Парето: ~10% товарів дають 80% грошей
 *   (перевірено на базі: 404 позиції з 4 079). Решта — довгий хвіст, який
 *   з'їдає полицю і увагу.
 *
 *   XYZ — передбачуваність попиту, коефіцієнт варіації по місяцях. Товар
 *   може давати мільйон і при цьому бути разовим постачанням під об'єкт —
 *   планувати склад під нього не можна.
 *
 * Разом вони дають матрицю рішень: AX тримати завжди (гроші + передбачувано),
 * AZ — возити під замовлення (гроші є, але вгадати момент неможливо),
 * CZ — кандидати на виведення з асортименту.
 *
 * Джерело — ті самі фільтри, що й у решті аналітики (facts.ts): реалізації
 * мінус повернення, лише документи з 1С, лише проведені.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { SOURCE_FILTER, clampFrom } from "@/lib/analytics/facts";

/**
 * Межі класів ABC за накопиченою часткою обороту.
 *
 * 80/95 — галузевий стандарт, і на наших даних він лягає майже ідеально:
 * A = 9,9% позицій, B = 26,2%, C = 63,9%. Підганяти пороги під базу не
 * довелося, тож лишаємо канонічні.
 */
const ABC_A = 0.8;
const ABC_B = 0.95;

/**
 * Межі класів XYZ за коефіцієнтом варіації (stddev / mean) по місяцях.
 *
 * Пороги вищі за підручникові 0,1/0,25, і це навмисно. Ми рахуємо варіацію
 * по ПОВНІЙ сітці місяців: місяць без продажів входить нулем, а не випадає
 * з вибірки. Інакше товар, проданий двічі за пів року однаковими партіями,
 * виглядав би ідеально стабільним (варіація 0) — хоча його попит якраз
 * найменш передбачуваний.
 *
 * З нулями розкид природно більший, тому 0,5/1,0. На базі це дає
 * X = 26 позицій (продаються 6,8 місяця з 7), Y = 511 (5,2), Z = 3458 (2,0) —
 * тобто класи справді розділяють регулярний товар і епізодичний.
 */
const XYZ_X = 0.5;
const XYZ_Y = 1.0;

/**
 * Мінімум місяців у періоді, щоб рахувати XYZ.
 *
 * На двох точках stddev формально рахується, але не означає нічого. Менше
 * трьох місяців — віддаємо клас null, і фронт показує «мало даних» замість
 * упевненої, але порожньої літери.
 */
const XYZ_MIN_MONTHS = 3;

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";

/** За яким виміром групувати: товар, бренд чи клієнт. */
export type AbcDimension = "product" | "brand" | "client";

/**
 * За чим рахувати класи: оборот чи валовий прибуток.
 *
 * Це різні списки, і різниця в них — головне, що дає ABC. Товар може
 * стояти в топі продажів і майже не приносити маржі: за оборотом він A,
 * за прибутком C. Продавати його далі, як «локомотив», — рішення, але
 * усвідомлене, а не за замовчуванням.
 *
 * ВАЖЛИВО: за прибутком у вибірку потрапляють лише рядки з відомою
 * собівартістю (purchasePrice > 0). Позиції без неї не «нульові» — вони
 * невідомі, і показувати їх у класі C означало б збрехати. Тому звіт
 * віддає `coverage` — частку обороту, для якої прибуток порахований.
 */
export type AbcBasis = "amount" | "profit";

export type AbcRow = {
  id: string;
  name: string;
  /** Бренд товару — лише для dimension = product, щоб не питати окремо. */
  brandName?: string | null;
  /** Оборот нетто за період (повернення вже відняті). */
  amount: number;
  /**
   * Валовий прибуток: виручка мінус собівартість, лише по рядках із
   * відомою собівартістю. Нуль означає «немає даних», не «нульова маржа».
   */
  profit: number;
  /** Рентабельність цієї позиції, % — null, якщо собівартість невідома. */
  marginPct: number | null;
  /** Кількість нетто. */
  qty: number;
  /** Скільки документів зачепило позицію — «разове чи регулярне». */
  docs: number;
  /** Частка в загальному обороті, %. */
  share: number;
  /** Накопичена частка від початку списку, % — межа класів видно очима. */
  cumShare: number;
  abc: AbcClass;
  /** null — місяців у періоді менше за XYZ_MIN_MONTHS. */
  xyz: XyzClass | null;
  /** Коефіцієнт варіації; null разом із xyz. */
  variation: number | null;
  /** У скількох місяцях періоду були продажі — пояснює клас Z. */
  activeMonths: number;
};

export type AbcSummary = {
  abc: AbcClass;
  count: number;
  amount: number;
  /** Частка позицій цього класу від їх загальної кількості, %. */
  countShare: number;
  /** Частка обороту, %. */
  amountShare: number;
};

/** Клітинка матриці ABC×XYZ — скільки позицій і грошей у перетині. */
export type AbcXyzCell = {
  abc: AbcClass;
  xyz: XyzClass;
  count: number;
  amount: number;
};

export type AbcReport = {
  dimension: AbcDimension;
  /** Чи класи рахувалися за оборотом, чи за прибутком. */
  basis: AbcBasis;
  /**
   * Частка обороту, для якої собівартість відома, %. При basis = "profit"
   * фронт зобов'язаний це показати: класи за прибутком, порахованим із
   * половини даних, — інша річ, ніж за повними.
   */
  coverage: number;
  /** Місяців у періоді — від них залежить, чи рахувався XYZ узагалі. */
  months: number;
  xyzAvailable: boolean;
  total: number;
  rows: AbcRow[];
  summary: AbcSummary[];
  matrix: AbcXyzCell[];
};

type RawRow = {
  id: string;
  name: string | null;
  brandName: string | null;
  amount: number;
  profit: number;
  /** Виручка тих рядків, де собівартість відома — знаменник маржі. */
  costedAmount: number;
  qty: number;
  docs: number;
  /** Помісячні суми, вже відсортовані за місяцем. */
  monthly: number[];
  activeMonths: number;
};

/**
 * Коефіцієнт варіації по повній сітці місяців.
 *
 * `monthly` містить лише місяці з продажами, тож відсутні добиваємо нулями
 * до `months` — див. коментар до XYZ_X про те, чому це принципово.
 *
 * Використовуємо популяційне stddev (ділимо на n, не на n−1): у нас не
 * вибірка з генеральної сукупності, а всі місяці періоду цілком.
 */
function variationOf(monthly: number[], months: number): number | null {
  if (months < XYZ_MIN_MONTHS) return null;

  const values = [...monthly];
  while (values.length < months) values.push(0);

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean <= 0) return null;

  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function xyzOf(variation: number | null): XyzClass | null {
  if (variation === null) return null;
  if (variation <= XYZ_X) return "X";
  if (variation <= XYZ_Y) return "Y";
  return "Z";
}

/** SQL-вираз ключа та назви для кожного виміру. */
function dimensionSql(dimension: AbcDimension): { id: Prisma.Sql; name: Prisma.Sql; join: Prisma.Sql } {
  switch (dimension) {
    case "brand":
      // Товари без бренду зводяться в один рядок: їх 9 тисяч, і кожен
      // окремим «— без бренду —» перетворив би звіт на смітник.
      return {
        id: Prisma.sql`COALESCE(p."brandId", '—')`,
        name: Prisma.sql`COALESCE(b.name, '— без бренду —')`,
        join: Prisma.sql`LEFT JOIN "Brand" b ON b.id = p."brandId"`,
      };
    case "client":
      return {
        id: Prisma.sql`COALESCE(s."counterpartyId", '—')`,
        name: Prisma.sql`COALESCE(c.name, '— без клієнта —')`,
        join: Prisma.sql`LEFT JOIN "Counterparty" c ON c.id = s."counterpartyId"`,
      };
    default:
      return {
        id: Prisma.sql`i."productId"`,
        name: Prisma.sql`p.name`,
        join: Prisma.sql`LEFT JOIN "Brand" b ON b.id = p."brandId"`,
      };
  }
}

/**
 * Скільки календарних місяців зачіпає період (за Києвом, включно).
 *
 * Рахуємо саме календарні, а не «днів / 30»: XYZ будується на помісячних
 * відрізках, і сітка має збігатися з тією, за якою групує SQL — інакше
 * нулів добилося б більше або менше, ніж є насправді.
 *
 * Місяць беремо з kyivDate, а не з getMonth(): сервер працює в UTC, і для
 * документа, створеного 1 числа о 02:00 за Києвом, локальний getMonth()
 * повернув би попередній місяць.
 */
function monthsBetween(from: Date, to: Date): number {
  const [fy, fm] = kyivDate(from).split("-").map(Number);
  const [ty, tm] = kyivDate(to).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Будує ABC/XYZ за період.
 *
 * `repId` звужує до одного торгового: у профілі це відповідає на питання
 * «на чому тримається його оборот», а не «на чому тримається компанія».
 */
export async function buildAbcReport(
  from: Date,
  to: Date,
  dimension: AbcDimension = "product",
  repId?: string | null,
  limit = 500,
  basis: AbcBasis = "amount"
): Promise<AbcReport> {
  from = clampFrom(from);
  const dim = dimensionSql(dimension);
  const repCondition = repId ? Prisma.sql`AND s."salesRepId" = ${repId}` : Prisma.empty;
  const months = monthsBetween(from, to);

  // Один запит на дві потреби: підсумки за період і помісячна розкладка для
  // варіації. array_agg по місяцях дешевший за другий прохід по 40 тис. рядків.
  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH monthly AS (
      SELECT
        ${dim.id} AS id,
        MIN(${dim.name}) AS name,
        ${dimension === "product" ? Prisma.sql`MIN(b.name)` : Prisma.sql`NULL::text`} AS "brandName",
        date_trunc('month', s."createdAt" AT TIME ZONE 'Europe/Kyiv') AS m,
        SUM(i.quantity * i."sellingPrice")::float AS amount,
        -- Прибуток і його база — лише по рядках із відомою собівартістю.
        -- Рядок без неї не «нульова маржа», а невідома, і мовчки зарахувати
        -- його виручку в прибуток означало б завищити маржу позиції.
        COALESCE(SUM((i."sellingPrice" - i."purchasePrice") * i.quantity)
          FILTER (WHERE i."purchasePrice" > 0), 0)::float AS profit,
        COALESCE(SUM(i."sellingPrice" * i.quantity)
          FILTER (WHERE i."purchasePrice" > 0), 0)::float AS "costedAmount",
        SUM(i.quantity)::float AS qty,
        COUNT(DISTINCT s.id)::int AS docs
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      ${dim.join}
      WHERE ${SOURCE_FILTER}
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
        ${repCondition}
      GROUP BY 1, 4
    )
    SELECT
      id,
      MIN(name) AS name,
      MIN("brandName") AS "brandName",
      SUM(amount)::float AS amount,
      SUM(profit)::float AS profit,
      SUM("costedAmount")::float AS "costedAmount",
      SUM(qty)::float AS qty,
      SUM(docs)::int AS docs,
      -- Варіація (XYZ) рахується по тій самій величині, що й класи: за
      -- прибутком «стабільний» означає стабільну маржу, а не оборот.
      array_agg(${basis === "profit" ? Prisma.sql`profit` : Prisma.sql`amount`} ORDER BY m)::float[] AS monthly,
      COUNT(*)::int AS "activeMonths"
    FROM monthly
    GROUP BY id
    HAVING SUM(amount) > 0
    ORDER BY ${basis === "profit" ? Prisma.sql`SUM(profit)` : Prisma.sql`SUM(amount)`} DESC
  `;

  // Позиції з нульовим або від'ємним нетто (повернули більше, ніж купили)
  // відсіяні в HAVING: у Парето вони не мають сенсу — накопичена частка
  // від них почала б спадати, і межі класів попливли б.
  // База класифікації: оборот або прибуток. Позиції зі збитком (від'ємний
  // прибуток) у Парето не працюють — накопичена частка від них спадає, і
  // межі класів пливуть. Тому при basis = "profit" вони відсіюються, але
  // лишаються в загальному покритті: збиток — не «немає даних».
  const valueOf = (r: RawRow) => (basis === "profit" ? r.profit : r.amount);
  const ranked = basis === "profit" ? rows.filter((r) => r.profit > 0) : rows;

  const total = ranked.reduce((s, r) => s + valueOf(r), 0);
  const revenueTotal = rows.reduce((s, r) => s + r.amount, 0);
  const costedTotal = rows.reduce((s, r) => s + r.costedAmount, 0);

  let cumulative = 0;
  const all: AbcRow[] = ranked.map((r) => {
    cumulative += valueOf(r);
    const cumShare = total > 0 ? cumulative / total : 0;
    const abc: AbcClass = cumShare <= ABC_A ? "A" : cumShare <= ABC_B ? "B" : "C";
    const variation = variationOf(r.monthly ?? [], months);

    return {
      id: r.id,
      name: r.name ?? "—",
      brandName: dimension === "product" ? r.brandName : undefined,
      amount: r.amount,
      profit: r.profit,
      marginPct: r.costedAmount > 0 ? (r.profit / r.costedAmount) * 100 : null,
      qty: r.qty,
      docs: r.docs,
      share: total > 0 ? (valueOf(r) / total) * 100 : 0,
      cumShare: cumShare * 100,
      abc,
      xyz: xyzOf(variation),
      variation,
      activeMonths: r.activeMonths,
    };
  });

  // Підсумки й матриця рахуються по ПОВНОМУ списку, а не по обрізаному:
  // інакше «клас C = 5% обороту» перетворилося б на «C = скільки влізло
  // в топ-500», і сума часток перестала б давати сто відсотків.
  const summary: AbcSummary[] = (["A", "B", "C"] as const).map((cls) => {
    const part = all.filter((r) => r.abc === cls);
    // Підсумок класу — у тих самих одиницях, що й класифікація: інакше
    // «клас A = 80%» не збіглося б із сумою його ж рядків.
    const amount = part.reduce((s, r) => s + (basis === "profit" ? r.profit : r.amount), 0);
    return {
      abc: cls,
      count: part.length,
      amount,
      countShare: all.length > 0 ? (part.length / all.length) * 100 : 0,
      amountShare: total > 0 ? (amount / total) * 100 : 0,
    };
  });

  const matrix: AbcXyzCell[] = [];
  for (const abc of ["A", "B", "C"] as const) {
    for (const xyz of ["X", "Y", "Z"] as const) {
      const part = all.filter((r) => r.abc === abc && r.xyz === xyz);
      if (part.length === 0) continue;
      matrix.push({
        abc,
        xyz,
        count: part.length,
        // У тих самих одиницях, що й класи — див. коментар у summary.
        amount: part.reduce((s, r) => s + (basis === "profit" ? r.profit : r.amount), 0),
      });
    }
  }

  return {
    dimension,
    basis,
    // Обрізаємо сотнею: costedAmount рахує виручку рядків із собівартістю,
    // а revenueTotal — нетто-оборот. Повернення мають собівартість, але
    // від'ємну виручку, тож на даних із поверненнями відношення трохи
    // перевищує 1 (виміряно 100,5%). Це не 100,5% покриття, а межа точності
    // самого показника — і показувати «100,5%» було б безглуздо.
    coverage: revenueTotal > 0 ? Math.min(100, (costedTotal / revenueTotal) * 100) : 0,
    months,
    xyzAvailable: months >= XYZ_MIN_MONTHS,
    total,
    rows: all.slice(0, limit),
    summary,
    matrix,
  };
}
