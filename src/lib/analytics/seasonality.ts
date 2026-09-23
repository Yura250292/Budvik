/**
 * Сезонність: як розподіляється рік усередині групи товарів.
 *
 * Задача, з якої це почалося, звучала так: «у мене на залишках мало
 * генераторів, чому ти мені їх не пропонуєш» — і одразу ж діагноз від
 * самого власника: «минулої зими ми продали багато генераторів, 180 днів
 * це літо і весна».
 *
 * Механізм збою саме такий. Закупівлі рахують швидкість за вікном у 90 або
 * 180 днів. Перед зимою це вікно накриває літо, де генераторів не
 * продавали, — отже продажів нуль, отже позиція не потрапляє в закупівлю
 * взагалі. Товар із вираженим сезоном СИСТЕМНО невидимий саме тоді, коли
 * його треба замовляти. Перевірено на базі: 229 SKU генераторів, залишок
 * 28 штук, 218 позицій із нулем; січень 13 штук, лютий 8, вересень 9, а
 * березень–серпень практично нуль.
 *
 * ── Три рішення, на яких тримається весь модуль ──────────────────────
 *
 * 1. ІНДЕКС ЛИШЕ ВІДНОСНИЙ. Частка місяця в році, нормована так, що 1,0 —
 *    звичайний місяць. Абсолютних гривень тут немає ніколи. Без нормування
 *    пік виходив у березні одразу в УСІХ розділів — просто тому, що
 *    березень був найкращим місяцем фірми (6,3 млн проти 2,8–4,7). Це не
 *    сезонність, це загальний рівень продажів та інфляція.
 *
 * 2. КОЖЕН РІК ДІЛИТЬСЯ НА ВЛАСНИЙ ПІДСУМОК. Тому зростання фірми зникає
 *    без жодного дефлятора. Пулити абсолютні суми двох років не можна:
 *    якби 2025 був у півтора раза більший, «профіль двох років» став би
 *    просто профілем 2025.
 *
 * 3. СЕЗОН ≠ ПОРА РОКУ. Розділ `klimat` має ДВА піки: лютий і серпень —
 *    вересень. Обігрівачі беруть, готуючись до сезону, а не в мороз.
 *    Календарний підхід («зима = грудень–лютий»), який стоїть на вітрині,
 *    запізнився б на три місяці. Профіль працює по МІСЯЦЯХ і дивиться на
 *    місяць-другий уперед.
 *
 * ── Чого модуль не робить ────────────────────────────────────────────
 *
 * Шок, що повторився обидва роки, статистикою не ловиться взагалі. Чесна
 * відповідь: не ловиться. Ловить власник, дивлячись на список груп.
 *
 * Модуль навмисно не імпортує нічого з `next/*` — він поїде у воркер для
 * щомісячного перерахунку. Це та сама умова, за якої взагалі можливий
 * воркер обміну.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivTsSql } from "@/lib/date/kyiv";
import { HISTORY_SINCE_DAY } from "@/lib/analytics/since";

/**
 * Власний фільтр джерела замість спільного SOURCE_FILTER — і це виправлення
 * після проби, а не смак.
 *
 * SOURCE_FILTER бере і реалізації, і повернення. Повернення в базі є з
 * 2023-01-03 (2650 документів), а реалізації — лише з 2026-01. Через це
 * перша ж проба оголосила 2024 і 2025 «повними роками» і зібралася
 * будувати сезон на самих поверненнях: за 2024-й у деяких розділах було
 * по одному документу на рік.
 *
 * Крім того, повернення не є попитом і приходить через тижні після
 * продажу, тобто змащує сам місяць, заради якого все це рахується.
 * Сезонність — це про те, коли товар БЕРУТЬ.
 */
const REALIZATIONS_ONLY = Prisma.sql`s."externalId" IS NOT NULL AND s.status = 'CONFIRMED' AND s."docType" = 'REALIZATION'`;

export type SeasonLevel = "SKU" | "TYPE" | "SECTION" | "BRAND" | "COMPANY";
export type SeasonConfidence = "HIGH" | "MEDIUM" | "LOW";

/** Дванадцять чисел, січень→грудень. 1,0 — звичайний місяць. */
export type MonthIndex = number[];

/** Рівний профіль: жодного сезону. Саме його віддають усі запобіжники. */
export const FLAT: MonthIndex = Array(12).fill(1);

/* ── Пороги. Кожен має причину, а не смак ───────────────────────────── */

/**
 * Скільки повних років потрібно, щоб узагалі рахувати профіль.
 *
 * Один рік — це не сезонність, а переказ одного року. Разовий сплеск
 * (відключення світла, один великий об'єкт) від справжнього сезону на
 * одному році не відрізнити нічим.
 */
const MIN_YEARS = 1;

/**
 * Рік вважається повним, коли в ньому 12 місяців із продажами і жоден не
 * провалений. Провалений — це місяць, де документів менше за п'яту частину
 * медіанного: ознака не «погано торгували», а «дані доїхали не всі».
 *
 * Перевірка йде по ФІРМІ, не по групі: група цілком законно може не
 * продаватись улітку — це і є сезон, який ми шукаємо.
 */
const WEAK_MONTH_SHARE = 0.2;

/**
 * Місяць, що тримався на одному документі. Понад третина місяця з однієї
 * накладної — це разове постачання під об'єкт, а не попит.
 *
 * Перевіряється НЕ в кожному місяці, а лише в тих, що вище середнього:
 * перша проба позначила так майже весь каталог, і це було правдою без
 * користі. У тихий місяць одна накладна легко дає третину обороту, але
 * закупівлю рухає не вона, а пік. Помилковою ознака стає саме тоді, коли
 * на одному документі тримається ПІК.
 */
const LUMPY_SHARE = 0.3;
const LUMPY_MONTH_MIN_INDEX = 1;

/** Кореляція часток між роками, нижче якої «сезон» не підтверджений. */
const AGREEMENT_HIGH = 0.5;

/** Скільки документів на рік потрібно для високої довіри. */
const DOCS_HIGH = 100;

/**
 * Межі сезонного коефіцієнта в закупівлі.
 *
 * Без верхньої індекс 4,0 на тонкій групі втроїв би замовлення дорогої
 * техніки: заявка на 200 тисяч стала б заявкою на 600. Нижня так само
 * потрібна: коефіцієнт 0,1 обнулив би закупівлю живого товару через один
 * аномальний місяць.
 */
export const SEASON_FACTOR_MIN = 0.5;
export const SEASON_FACTOR_MAX = 3;

/* ── Типи ────────────────────────────────────────────────────────────── */

export type SeasonProfile = {
  level: SeasonLevel;
  key: string;
  label: string;
  years: number[];
  qtyIndex: MonthIndex;
  amountIndex: MonthIndex;
  /** Сирі помісячні числа по роках — щоб індекс можна було перевірити очима. */
  monthly: Record<number, { qty: number[]; amount: number[]; docs: number[] }>;
  yearAgreement: number | null;
  amplitude: number;
  lumpy: boolean;
  docs: number;
  qty: number;
  amount: number;
  confidence: SeasonConfidence;
};

type RawMonth = {
  k: string;
  label: string | null;
  y: number;
  m: number;
  qty: number;
  amount: number;
  docs: number;
  /** Найбільший документ місяця — для ознаки `lumpy`. */
  topDoc: number;
};

/* ── Математика ──────────────────────────────────────────────────────── */

/**
 * Кореляція Пірсона між двома роками часток.
 *
 * Саме вона відрізняє сезон від збігу: справжній сезон повторюється, тож
 * дванадцять часток 2024-го йдуть у лад із дванадцятьма частками 2025-го.
 * Разовий сплеск лад ламає, і група чесно не називається сезонною.
 */
function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 6) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da <= 0 || db <= 0) return null;
  return num / Math.sqrt(da * db);
}

/**
 * Індекс із помісячних сум: частка місяця в році, усереднена по роках.
 *
 * Множимо на 12, щоб одиниця означала «звичайний місяць», а не 1/12 —
 * так число читається без калькулятора: ×1,6 це «на шістдесят відсотків
 * більше за звичайний місяць».
 */
function indexFrom(byYear: Map<number, number[]>): { index: MonthIndex; agreement: number | null } {
  const years = [...byYear.keys()].sort();
  const shares: number[][] = [];

  for (const y of years) {
    const months = byYear.get(y)!;
    const total = months.reduce((s, v) => s + v, 0);
    // Рік без продажів у частки не перетворюється: ділення на нуль тут
    // означало б вигадати профіль там, де даних не було.
    if (total <= 0) continue;
    shares.push(months.map((v) => v / total));
  }
  if (shares.length === 0) return { index: [...FLAT], agreement: null };

  const index = Array.from({ length: 12 }, (_, m) => {
    const sum = shares.reduce((s, sh) => s + sh[m], 0);
    return (sum / shares.length) * 12;
  });

  const agreement = shares.length >= 2 ? correlation(shares[0], shares[1]) : null;
  return { index, agreement };
}

/**
 * Наскільки сезон виражений: у скільки разів пік більший за звичайний місяць.
 *
 * Це просто максимум індексу, і так вийшло не випадково: середнє по
 * дванадцяти індексах дорівнює одиниці за самою побудовою, тож максимум
 * ВЖЕ є відношенням піку до середнього.
 *
 * Перша версія ділила пік на провал — і проба показала, чому так не
 * можна: у всіх без винятку груп вийшло рівно 3,0. Місяць із нулем
 * продажів цілком законний (саме він і є сезон, який ми шукаємо), а
 * ділення на нуль упиралось у стелю. Міра, однакова для всіх, не міра.
 */
function amplitudeOf(index: MonthIndex): number {
  return Math.max(...index);
}

/* ── Збір профілів ───────────────────────────────────────────────────── */

/** SQL ключа й назви для кожного рівня. */
function levelSql(level: SeasonLevel): { key: Prisma.Sql; label: Prisma.Sql; join: Prisma.Sql; where: Prisma.Sql } {
  switch (level) {
    case "TYPE":
      return {
        key: Prisma.sql`p."typeKey"`,
        label: Prisma.sql`COALESCE(p."typeKey", '—')`,
        join: Prisma.empty,
        where: Prisma.sql`AND p."typeKey" IS NOT NULL`,
      };
    case "SECTION":
      return {
        key: Prisma.sql`p."sectionId"`,
        label: Prisma.sql`COALESCE(p."sectionId", '—')`,
        join: Prisma.empty,
        where: Prisma.sql`AND p."sectionId" IS NOT NULL`,
      };
    case "BRAND":
      return {
        key: Prisma.sql`p."brandId"`,
        label: Prisma.sql`COALESCE(b.name, '—')`,
        join: Prisma.sql`LEFT JOIN "Brand" b ON b.id = p."brandId"`,
        where: Prisma.sql`AND p."brandId" IS NOT NULL`,
      };
    case "SKU":
      return {
        key: Prisma.sql`i."productId"`,
        label: Prisma.sql`p.name`,
        join: Prisma.empty,
        where: Prisma.empty,
      };
    default:
      return {
        key: Prisma.sql`'all'`,
        label: Prisma.sql`'Уся фірма'`,
        join: Prisma.empty,
        where: Prisma.empty,
      };
  }
}

/**
 * Помісячні суми за рівнем — від межі історії донині.
 *
 * `clampFrom` тут НЕ викликається навмисно: він обрізав би вибірку до
 * ANALYTICS_SINCE_DAY, тобто до 2026 року, і профіль будувався б на
 * дев'яти місяцях. Межа історії — окреме число саме заради цього.
 */
async function monthlyRows(level: SeasonLevel): Promise<RawMonth[]> {
  const L = levelSql(level);
  const since = new Date(`${HISTORY_SINCE_DAY}T00:00:00+02:00`);
  const kyiv = Prisma.raw(kyivTsSql('s."createdAt"'));

  return prisma.$queryRaw<RawMonth[]>`
    WITH per_doc AS (
      SELECT
        ${L.key} AS k,
        MIN(${L.label}) AS label,
        EXTRACT(YEAR FROM ${kyiv})::int AS y,
        EXTRACT(MONTH FROM ${kyiv})::int AS m,
        s.id AS doc,
        SUM(i.quantity)::float AS qty,
        SUM(i.quantity * i."sellingPrice")::float AS amount
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      ${L.join}
      WHERE ${REALIZATIONS_ONLY}
        AND s."createdAt" >= ${since}
        ${L.where}
      GROUP BY 1, 3, 4, 5
    )
    SELECT
      k,
      MIN(label) AS label,
      y,
      m,
      SUM(qty)::float AS qty,
      SUM(amount)::float AS amount,
      COUNT(*)::int AS docs,
      -- Найбільший документ місяця: якщо він тягне понад третину, місяць
      -- тримався на одному постачанні, а не на попиті.
      MAX(amount)::float AS "topDoc"
    FROM per_doc
    GROUP BY k, y, m
  `;
}

/**
 * Які роки придатні для профілю.
 *
 * Перевірка по ФІРМІ цілком: 12 місяців із продажами і жодного
 * провáленого. Неповний рік у профіль не входить ніколи — саме через це
 * профіль на напівзавантаженому бекфілі не вигадає «сезон другого
 * півріччя».
 */
export async function completeYears(): Promise<{ years: number[]; note: string }> {
  const rows = await monthlyRows("COMPANY");
  if (rows.length === 0) return { years: [], note: "Реалізацій у базі немає взагалі" };

  const byYear = new Map<number, Map<number, number>>();
  for (const r of rows) {
    if (!byYear.has(r.y)) byYear.set(r.y, new Map());
    byYear.get(r.y)!.set(r.m, r.docs);
  }

  const good: number[] = [];
  const notes: string[] = [];
  for (const [y, months] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    if (months.size < 12) {
      notes.push(`${y}: лише ${months.size} міс.`);
      continue;
    }
    const counts = [...months.values()].sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)];
    const weak = counts.filter((c) => c < median * WEAK_MONTH_SHARE).length;
    if (weak > 0) {
      notes.push(`${y}: ${weak} провалених міс.`);
      continue;
    }
    good.push(y);
  }
  return { years: good, note: notes.join("; ") || "усі роки повні" };
}

/**
 * Будує профілі одного рівня.
 *
 * Одиниця різна за рівнями, і це не дрібниця: група (`typeKey`) однорідна,
 * тож штуки в ній складаються осмислено; розділ і бренд — ні, і додавати
 * штуки саморізів до штук бензопил безглуздо, там рахуються гроші.
 * Зберігаємо обидва масиви, а довіру рахуємо за основною одиницею рівня.
 */
export async function buildProfiles(level: SeasonLevel, years: number[]): Promise<SeasonProfile[]> {
  if (years.length < MIN_YEARS) return [];

  const rows = (await monthlyRows(level)).filter((r) => years.includes(r.y));
  const groups = new Map<string, RawMonth[]>();
  for (const r of rows) {
    if (!r.k) continue;
    const list = groups.get(r.k);
    if (list) list.push(r);
    else groups.set(r.k, [r]);
  }

  const out: SeasonProfile[] = [];
  for (const [key, list] of groups) {
    const qtyByYear = new Map<number, number[]>();
    const amountByYear = new Map<number, number[]>();
    const docsByYear = new Map<number, number[]>();
    let lumpy = false;

    for (const y of years) {
      qtyByYear.set(y, Array(12).fill(0));
      amountByYear.set(y, Array(12).fill(0));
      docsByYear.set(y, Array(12).fill(0));
    }
    for (const r of list) {
      qtyByYear.get(r.y)![r.m - 1] = r.qty;
      amountByYear.get(r.y)![r.m - 1] = r.amount;
      docsByYear.get(r.y)![r.m - 1] = r.docs;
    }

    const qtyRes = indexFrom(qtyByYear);
    const amountRes = indexFrom(amountByYear);

    // Ознака ставиться лише по місяцях вище середнього — див. LUMPY_SHARE.
    for (const r of list) {
      if (r.amount <= 0) continue;
      if (amountRes.index[r.m - 1] < LUMPY_MONTH_MIN_INDEX) continue;
      if (r.topDoc / r.amount > LUMPY_SHARE) lumpy = true;
    }
    const docs = list.reduce((s, r) => s + r.docs, 0);
    const qty = list.reduce((s, r) => s + r.qty, 0);
    const amount = list.reduce((s, r) => s + r.amount, 0);

    // Одиниця рівня: група — штуки, решта — гроші.
    const main = level === "TYPE" || level === "SKU" ? qtyRes : amountRes;
    const activeMonths = list.filter((r) => r.qty > 0 || r.amount > 0).length;

    const confidence: SeasonConfidence =
      years.length >= 2 &&
      docs >= DOCS_HIGH * years.length &&
      activeMonths >= years.length * 10 &&
      (main.agreement ?? 0) >= AGREEMENT_HIGH &&
      !lumpy
        ? "HIGH"
        : docs >= 20 && activeMonths >= years.length * 6
          ? "MEDIUM"
          : "LOW";

    const monthly: SeasonProfile["monthly"] = {};
    for (const y of years) {
      monthly[y] = {
        qty: qtyByYear.get(y)!,
        amount: amountByYear.get(y)!,
        docs: docsByYear.get(y)!,
      };
    }

    out.push({
      level,
      key,
      label: list[0]?.label ?? key,
      years,
      qtyIndex: qtyRes.index,
      amountIndex: amountRes.index,
      monthly,
      yearAgreement: main.agreement,
      amplitude: amplitudeOf(main.index),
      lumpy,
      docs,
      qty,
      amount,
      confidence,
    });
  }

  return out.sort((a, b) => b.amount - a.amount);
}

/** Перерахунок і запис у таблицю — для воркера й ручного прогону. */
export async function recomputeProfiles(): Promise<{ years: number[]; written: number; note: string }> {
  const { years, note } = await completeYears();
  if (years.length < MIN_YEARS) return { years, written: 0, note };

  let written = 0;
  for (const level of ["TYPE", "SECTION", "BRAND", "COMPANY"] as const) {
    const profiles = await buildProfiles(level, years);
    for (const p of profiles) {
      await prisma.seasonProfile.upsert({
        where: { level_key: { level: p.level, key: p.key } },
        create: {
          level: p.level,
          key: p.key,
          label: p.label,
          years: p.years,
          qtyIndex: p.qtyIndex,
          amountIndex: p.amountIndex,
          monthly: p.monthly as unknown as Prisma.InputJsonValue,
          yearAgreement: p.yearAgreement,
          amplitude: p.amplitude,
          lumpy: p.lumpy,
          docs: p.docs,
          qty: p.qty,
          amount: p.amount,
          confidence: p.confidence,
        },
        update: {
          label: p.label,
          years: p.years,
          qtyIndex: p.qtyIndex,
          amountIndex: p.amountIndex,
          monthly: p.monthly as unknown as Prisma.InputJsonValue,
          yearAgreement: p.yearAgreement,
          amplitude: p.amplitude,
          lumpy: p.lumpy,
          docs: p.docs,
          qty: p.qty,
          amount: p.amount,
          confidence: p.confidence,
          computedAt: new Date(),
        },
      });
      written++;
    }
  }
  return { years, written, note };
}

/* ── Читання профілю ────────────────────────────────────────────────── */

export type SeasonLookup = {
  index: MonthIndex;
  confidence: SeasonConfidence;
  /** На якому рівні знайшлося — щоб у відповіді чесно писати «сезон групи». */
  level: SeasonLevel | null;
  label: string | null;
  years: number[];
  lumpy: boolean;
  amplitude: number;
};

/** Рівний результат: профілю немає, і нічого не змінюється. */
export const NO_SEASON: SeasonLookup = {
  index: FLAT,
  confidence: "LOW",
  level: null,
  label: null,
  years: [],
  lumpy: false,
  amplitude: 1,
};

/**
 * Профілі однією вибіркою — для сторінок, де рядків сотні.
 *
 * Ходити в базу за кожним товаром на екрані закупівель означало б сотні
 * запитів на один клік фільтра.
 */
export async function loadProfiles(level: SeasonLevel, keys: string[]): Promise<Map<string, SeasonLookup>> {
  const map = new Map<string, SeasonLookup>();
  if (keys.length === 0) return map;

  const rows = await prisma.seasonProfile.findMany({
    where: { level, key: { in: [...new Set(keys)] } },
  });
  for (const r of rows) {
    map.set(r.key, {
      index: level === "TYPE" || level === "SKU" ? r.qtyIndex : r.amountIndex,
      confidence: r.confidence,
      level: r.level,
      label: r.label,
      years: r.years,
      lumpy: r.lumpy,
      amplitude: r.amplitude,
    });
  }
  return map;
}

/**
 * Драбина успадкування: товар → група → розділ → уся фірма.
 *
 * Кожна сходинка спрацьовує, коли попередня не набрала довіри. Так
 * значення визначене ЗАВЖДИ і жодне не вигадане: новий SKU 2025 року
 * успадковує сезон своєї групи, а не створює фальшивий «сезон другого
 * півріччя». У відповіді при цьому прямо пишеться, з якого рівня взято.
 *
 * Чому група, а не категорія 1С: у дереві 1С є категорії-звалища (84%
 * рядків лежали в одній), а групи каталогу однорідні й переживають зміну
 * асортименту.
 */
export async function seasonFor(item: {
  productId?: string | null;
  typeKey?: string | null;
  sectionId?: string | null;
}): Promise<SeasonLookup> {
  const steps: Array<[SeasonLevel, string | null | undefined]> = [
    ["SKU", item.productId],
    ["TYPE", item.typeKey],
    ["SECTION", item.sectionId],
    ["COMPANY", "all"],
  ];

  for (const [level, key] of steps) {
    if (!key) continue;
    const found = await loadProfiles(level, [key]);
    const hit = found.get(key);
    // MEDIUM теж береться: він показується із застереженням, але в
    // закупівлю не пускається — це вирішує вже той, хто питає.
    if (hit && hit.confidence !== "LOW") return hit;
  }
  return NO_SEASON;
}

/* ── Застосування ────────────────────────────────────────────────────── */

/**
 * Чи можна цим профілем рухати замовлення.
 *
 * Лише висока довіра і не `lumpy`. MEDIUM показується людині, але грошей
 * не витрачає: помилитись у бік «показали зайве» дешево, у бік «замовили
 * втричі більше дорогої техніки» — ні.
 */
export function usableForPurchase(s: SeasonLookup): boolean {
  return s.confidence === "HIGH" && !s.lumpy;
}

/**
 * Скільки продали б у звичайний місяць — і скільки візьмуть далі.
 *
 * Десезоналізація й зворотна засезоналізація:
 *
 *   avgIdx      = середній індекс місяців, які накриває вікно швидкості
 *   baseMonthly = perMonth / avgIdx      // «звичайний місяць»
 *   forward(H)  = baseMonthly × сума індексів H наступних місяців
 *
 * Чотири властивості, заради яких саме так:
 *
 *   1. СИМЕТРИЧНО Й БЕЗПЕЧНО. Немає профілю або довіра низька — усі
 *      індекси 1,0, і `forward(2) = perMonth × 2`, тобто число до гривні
 *      те саме, що й сьогодні. Для більшості каталогу не змінюється
 *      нічого, і це можна довести діфом.
 *   2. Лікує обидві помилки: завищення (літній товар у вересні) і
 *      заниження (зимовий у серпні).
 *   3. Вибір вікна перестає бути пасткою: 30 і 180 днів після
 *      десезоналізації дають близькі числа.
 *   4. Горизонт стає явним параметром, а не припущенням.
 *
 * `month` — поточний місяць, 1–12.
 */
export function forwardDemand(input: {
  perMonth: number;
  month: number;
  windowDays: number;
  horizonMonths: number;
  season: SeasonLookup;
}): { expected: number; factor: number; applied: boolean } {
  const { perMonth, month, windowDays, horizonMonths, season } = input;
  const flat = perMonth * horizonMonths;
  if (!usableForPurchase(season)) return { expected: flat, factor: 1, applied: false };

  const idx = season.index;
  const backMonths = Math.max(1, Math.round(windowDays / 30));

  // Середній індекс вікна, яке дало perMonth: саме на нього ділимо, щоб
  // прибрати сезон із бази, перш ніж накласти сезон майбутнього.
  let back = 0;
  for (let i = 1; i <= backMonths; i++) {
    const m = ((month - i) % 12 + 12) % 12;
    back += idx[m];
  }
  const avgIdx = back / backMonths;
  if (avgIdx <= 0) return { expected: flat, factor: 1, applied: false };

  let ahead = 0;
  for (let i = 0; i < horizonMonths; i++) {
    ahead += idx[(month - 1 + i) % 12];
  }

  const raw = ahead / (avgIdx * horizonMonths);
  const factor = Math.min(SEASON_FACTOR_MAX, Math.max(SEASON_FACTOR_MIN, raw));
  return { expected: flat * factor, factor, applied: true };
}

/**
 * Групи, що входять у сезон найближчим часом.
 *
 * Саме на цьому тримаються дві речі: рядок у ранковому зведенні й список
 * «Готуватися до сезону» в закупівлях. Порівнюємо індекс наступних
 * місяців із поточним — питання не «яка зараз пора року», а «що зросте
 * проти того, що є».
 */
export async function risingGroups(input: {
  month: number;
  aheadMonths?: number;
  minFactor?: number;
  limit?: number;
}): Promise<Array<{ key: string; label: string; factor: number; index: MonthIndex; years: number[] }>> {
  const ahead = input.aheadMonths ?? 2;
  const minFactor = input.minFactor ?? 1.25;

  const rows = await prisma.seasonProfile.findMany({
    where: { level: "TYPE", confidence: "HIGH", lumpy: false },
  });

  const out = rows
    .map((r) => {
      const idx = r.qtyIndex;
      const now = idx[(input.month - 1) % 12] || 1;
      let sum = 0;
      for (let i = 1; i <= ahead; i++) sum += idx[(input.month - 1 + i) % 12];
      const next = sum / ahead;
      return { key: r.key, label: r.label, factor: now > 0 ? next / now : 1, index: idx, years: r.years };
    })
    .filter((g) => g.factor >= minFactor)
    .sort((a, b) => b.factor - a.factor);

  return out.slice(0, input.limit ?? 5);
}
