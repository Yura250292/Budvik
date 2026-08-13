import { prisma } from "@/lib/prisma";

/**
 * Звіт закупівельника: що замовити.
 *
 * Головна ідея — дефіцит визначає ОБІГ, а не сам по собі малий залишок.
 * У каталозі 40 159 товарів із брендом, і 33 418 із них мертві: нуль
 * продажів за 90 днів і нуль на складі. Формальний поріг «менше 10 шт»
 * записав би всіх їх у дефіцит і поховав би справжню роботу — 271 позицію,
 * які продаються і скінчились. Тому мертві товари не потрапляють у звіт
 * узагалі, а порядок задає severity (див. нижче).
 *
 * Пороги лишаються, але як запасний варіант для позицій без історії
 * продажів: дорога техніка обертається одиницями, оснастка йде пачками.
 */

const VELOCITY_DAYS = 90;

export type LowStockParams = {
  /** null — усі бренди (огляд по складу). */
  brandId: string | null;
  expensivePrice: number;
  expensiveMin: number;
  cheapMin: number;
  /** Показувати позиції без продажів за 90 днів (за замовчуванням — ні). */
  includeDead?: boolean;
  /** Пошук за назвою або артикулом. */
  search?: string;
};

export const DEFAULT_PARAMS = { expensivePrice: 1000, expensiveMin: 5, cheapMin: 10 };

/**
 * 0 — продається, але скінчилось (пекуче);
 * 1 — продається, залишку менше ніж на місяць;
 * 2 — залишок нижче норми (без історії продажів);
 * 3 — усе гаразд.
 */
export type Severity = 0 | 1 | 2 | 3;

export type LowStockItem = {
  id: string;
  sku: string | null;
  name: string;
  brandName: string;
  price: number;
  stock: number;
  expensive: boolean;
  threshold: number;
  severity: Severity;
  /** Продано за 90 днів (з урахуванням повернень). */
  sold90: number;
  /** Середній продаж на місяць. */
  perMonth: number;
  /** На скільки днів вистачить залишку; null — не продається. */
  daysLeft: number | null;
  /** Скільки радимо замовити, щоб вистачило на ~2 місяці (мінімум — норма). */
  suggested: number;
};

export type LowStockGroup = { name: string; total: number; toOrder: number; items: LowStockItem[] };
export type LowStockSection = { name: string; total: number; toOrder: number; groups: LowStockGroup[] };

export type BrandSummary = {
  id: string;
  name: string;
  total: number;
  toOrder: number;
  outOfStock: number;
  /** Скільки грошей потрібно на рекомендовану закупівлю. */
  orderCost: number;
};

export type LowStockReport = {
  brand: { id: string; name: string } | null;
  params: Omit<LowStockParams, "brandId">;
  velocityDays: number;
  total: number;
  toOrder: number;
  zeroStock: number;
  /** Пекучі: продаються і скінчились. */
  urgent: number;
  /** Орієнтовна сума рекомендованої закупівлі. */
  orderCost: number;
  /** Скільки мертвих позицій сховано (0 продажів і 0 залишку). */
  hiddenDead: number;
  /** Позицій до замовлення, у яких немає ціни — вони не входять в orderCost. */
  noPrice: number;
  brands: BrandSummary[];
  sections: LowStockSection[];
};

// Розділи в порядку показу — як гілка GROSSER у дереві номенклатури 1С.
const SEC = {
  AKB: "Акумуляторний інструмент",
  SAD: "Садовий інструмент",
  ZVAR: "Зварювальний інструмент",
  BENZ: "Бензиновий інструмент",
  MER: "Мережевий інструмент",
  ROZ: "Розхідний інструмент і оснастка",
  INS: "Інше",
} as const;

const SECTION_ORDER: string[] = Object.values(SEC);

// Порядок правил важливий: перше збіжене виграє. «Пила ланцюгова» має
// спрацювати раніше за «пилу» взагалі, «ланцюг пильний» — раніше за
// «ланцюгову пилу». JS-\b не працює з кирилицею, тому межі слів — явні.
const RULES: Array<[RegExp, string, string]> = [
  // «лацнюги» — не помилка тут, а одруківка в назвах товарів у базі.
  [/ланцюг пильний|(^|\s)шина(\s|\d)|ла[нц]{2}юги\+шина/i, SEC.ROZ, "Ланцюги і шини"],
  [/ліска для тримера|котушка для тримера|ніж .*(GGT|тример)|ніж \dт/i, SEC.ROZ, "Ліски і ножі для тримерів"],
  [/диск з победіт|диск пильний|пильний диск|круг відрізний|круг зачисний/i, SEC.ROZ, "Диски і круги"],
  [/зварювальний пальник|пальник (mig|tig)/i, SEC.ZVAR, "Пальники"],
  [/маска звар|хамелеон/i, SEC.ZVAR, "Маски зварювальника"],
  [/зварюванн|зварювальн|напівавтомат|плазморіз|електрод|(^|\s)tig-|(^|\s)mig-/i, SEC.ZVAR, "Апарати, напівавтомати, плазморізи"],
  [/мотокоса/i, SEC.SAD, "Мотокоси"],
  [/пила бензинова|бензопила/i, SEC.BENZ, "Пили бензинові"],
  [/мотобур|шнек/i, SEC.BENZ, "Мотобури і шнеки"],
  [/генератор/i, SEC.BENZ, "Генератори"],
  [/пила ланцюгова|ланцюгова пила/i, SEC.SAD, "Пили ланцюгові"],
  [/тример/i, SEC.SAD, "Тримери"],
  [/секатор/i, SEC.SAD, "Секатори"],
  [/кущеріз|кущоріз|ножиці садові|садові ножиці|(^|\s)ножиці/i, SEC.SAD, "Кущорізи і садові ножиці"],
  [/обприскувач/i, SEC.SAD, "Обприскувачі"],
  [/культиватор|газонокосарка/i, SEC.SAD, "Культиватори і газонокосарки"],
  [/повітродувка|садовий пилосос/i, SEC.SAD, "Повітродувки"],
  [/набір садовий|садовий набір|подовжувач телескоп|телескопічний подовжувач/i, SEC.SAD, "Садові набори і подовжувачі"],
  [/кормоподрібнювач|зернодробарка/i, SEC.INS, "Господарська техніка"],
  [/батарея|акумулятор(?!н)|зарядний|адаптер живлення|ранець для акумулятор|перетворювач живлення|інвертор/i, SEC.AKB, "Батареї, зарядні та живлення"],
  [/шуруповерт|гвинтоверт|дриль/i, SEC.AKB, "Шуруповерти і гвинтоверти"],
  [/гайковерт|тріскачка/i, SEC.AKB, "Гайковерти"],
  [/болгарка|болграка|кутова шліфмашина|кшм/i, SEC.AKB, "Болгарки (КШМ)"],
  [/перфоратор|відбійний молоток/i, SEC.AKB, "Перфоратори"],
  [/циркулярна пила|лобзик|шабельна пила|торцювальна пила/i, SEC.AKB, "Пили дискові, лобзики, шабельні"],
  [/шліфмашина|фрезер|верстат для заточування|точило/i, SEC.AKB, "Шліфмашини, фрезери, заточування"],
  [/міксер/i, SEC.AKB, "Міксери будівельні"],
  [/ліхтар|прожектор/i, SEC.AKB, "Ліхтарі"],
  [/присоска|вібратор|ущільнювач бетону|вентилятор|(^|\s)фен(\s|$)|бур |пилосос|мийка|фарбопульт|пароочисник|автокомпресор|компресор|колонка|степлер|клейовий|паяльник|мультитул|багатофункціональн|набір інструментів/i, SEC.AKB, "Інший акумуляторний інструмент"],
];

// Категорії-звалища: шлях по дереву не несе інформації, класифікуємо за назвою.
const JUNK_CATEGORIES = /^(Імпорт з 1С|1972|Ремонти)$/i;

// Той самий інструмент буває бензиновий і акумуляторний (мотокоса, пилка,
// повітродувка), а закупівельник розділяє їх за паливом. Тип інструмента дає
// групу, паливо — розділ, тож правило не треба дублювати для кожної пари.
const PETROL = /бензинов|бензо|4T|двотактн|двигун внутрішнього/i;

function classify(name: string, categoryPath: string[]): { section: string; group: string } {
  const path = categoryPath.join(" / ");
  if (/мережевий/i.test(path)) return { section: SEC.MER, group: "Мережевий інструмент" };
  for (const [re, section, group] of RULES) {
    if (re.test(name)) {
      // Бензиновий садовий інструмент їде у «Бензиновий», зберігаючи групу.
      if (section === SEC.SAD && PETROL.test(name)) return { section: SEC.BENZ, group };
      return { section, group };
    }
  }
  if (/розхідний/i.test(path)) return { section: SEC.ROZ, group: "Інша оснастка" };
  // Осмислена (не звалищна) категорія — хай буде групою в «Іншому».
  const leaf = categoryPath[categoryPath.length - 1];
  if (leaf && !JUNK_CATEGORIES.test(leaf)) return { section: SEC.INS, group: leaf };
  return { section: SEC.INS, group: "Некласифіковане" };
}

/** Продано за VELOCITY_DAYS днів по кожному товару (повернення вже з мінусом). */
async function loadVelocity(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ productId: string; sold: bigint }>>`
    SELECT i."productId", SUM(i.quantity)::bigint AS sold
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" d ON d.id = i."salesDocumentId"
    WHERE d."docType" IN ('REALIZATION','RETURN')
      AND d.status = 'CONFIRMED'
      AND d."createdAt" >= NOW() - INTERVAL '90 days'
    GROUP BY i."productId"
  `;
  return new Map(rows.map((r) => [r.productId, Number(r.sold)]));
}

export async function buildLowStockReport(params: LowStockParams): Promise<LowStockReport | null> {
  const brand = params.brandId
    ? await prisma.brand.findUnique({ where: { id: params.brandId }, select: { id: true, name: true } })
    : null;
  if (params.brandId && !brand) return null;

  const search = params.search?.trim();
  const velocityPromise = loadVelocity();
  // Мертві товари (0 продажів і 0 залишку) — 33 з 40 тисяч. Відсікаємо їх
  // у SQL, а не в JS: інакше з бази щоразу їде 40 тис. рядків заради 7 тис.
  // потрібних, і огляд по всіх брендах стає вчетверо повільнішим.
  const soldIds = params.includeDead ? null : [...(await velocityPromise).keys()];

  const [products, categories, velocity] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        // Тільки те, що є в базі 1С: externalId — це Ref_Key номенклатури.
        // Позиції без нього — старі записи магазину, яких в обліку немає,
        // і ціни в них синхронізація ніколи не оновлює. Єдина істина — 1С.
        externalId: { not: null },
        ...(params.brandId ? { brandId: params.brandId } : { brandId: { not: null } }),
        ...(soldIds ? { OR: [{ stock: { gt: 0 } }, { id: { in: soldIds } }] } : {}),
        ...(search
          ? { AND: [{ OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] }] }
          : {}),
      },
      select: {
        id: true, sku: true, name: true, price: true, stock: true, categoryId: true,
        brandId: true, brand: { select: { name: true } },
      },
    }),
    prisma.category.findMany({ select: { id: true, name: true, parentId: true } }),
    velocityPromise,
  ]);

  // Мертві відсіяні в SQL, тож рахуємо їх окремо — інакше цифра «сховано»
  // мовчки показувала б нуль, і закупівельник не знав би, що звіт неповний.
  const hiddenDead = soldIds
    ? await prisma.product.count({
        where: {
          isActive: true,
          externalId: { not: null },
          ...(params.brandId ? { brandId: params.brandId } : { brandId: { not: null } }),
          stock: 0,
          id: { notIn: soldIds },
          NOT: { name: { startsWith: "РЕМОНТ" } },
        },
      })
    : 0;

  const catById = new Map(categories.map((c) => [c.id, c]));
  // Кеш шляхів: товари тисячами сидять в одних і тих самих категоріях,
  // а обхід дерева вгору для кожного з них — найдорожча частина звіту.
  const pathCache = new Map<string, string[]>();
  const pathOf = (id: string): string[] => {
    const cached = pathCache.get(id);
    if (cached) return cached;
    const parts: string[] = [];
    // seen — не перестраховка: дерево приходить із 1С, і цикл A→B→A
    // (який sync не ловить) підвісив би запит у нескінченному циклі.
    const seen = new Set<string>();
    let cur = catById.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentId ? catById.get(cur.parentId) : undefined;
    }
    pathCache.set(id, parts);
    return parts;
  };


  // Сервісні позиції «РЕМОНТ …» — не товар, який замовляють у постачальника.
  const goods = products.filter((p) => !/^РЕМОНТ/i.test(p.name.trim()));

  const sections = new Map<string, Map<string, LowStockItem[]>>();
  const brandAgg = new Map<string, BrandSummary>();
  let toOrder = 0;
  let zeroStock = 0;
  let urgent = 0;
  let orderCost = 0;
  let noPrice = 0;

  for (const p of goods) {
    const sold90 = Math.max(0, velocity.get(p.id) ?? 0);
    const perMonth = sold90 / 3;

    // Ціна 0 — це «ціна не приїхала з 1С», а не дешевий товар (див.
    // [[product-grouping-brand-not-category]]: 486 позицій без ціни).
    const priceKnown = p.price > 0;
    const expensive = p.price >= params.expensivePrice;
    const threshold = expensive ? params.expensiveMin : params.cheapMin;
    const daysLeft = perMonth > 0 ? Math.round((p.stock / perMonth) * 30) : null;

    // Одна продажа за квартал — це разове замовлення під клієнта, а не
    // товар, який магазин тримає. Без цієї межі половина «термінових»
    // виявлялась позиціями, проданими один раз, і ховала справжні дірки.
    const REGULAR = 2;

    let severity: Severity;
    if (sold90 >= REGULAR && p.stock === 0) severity = 0;
    else if (daysLeft !== null && daysLeft < 30) severity = 1;
    else if (sold90 > 0 && sold90 < REGULAR && p.stock === 0) severity = 2;
    else if (sold90 === 0 && priceKnown && p.stock < threshold) severity = 2;
    else severity = 3;

    // Рекомендація: закрити ~2 місяці продажів, але не менше норми.
    const suggested =
      severity === 3 ? 0 : Math.max(threshold - p.stock, Math.ceil(perMonth * 2) - p.stock, 0);

    if (severity < 3) {
      toOrder++;
      orderCost += suggested * p.price;
      if (!priceKnown) noPrice++;
    }
    if (p.stock === 0) zeroStock++;
    if (severity === 0) urgent++;

    if (p.brandId) {
      const bName = p.brand?.name ?? "—";
      const agg = brandAgg.get(p.brandId) ?? { id: p.brandId, name: bName, total: 0, toOrder: 0, outOfStock: 0, orderCost: 0 };
      agg.total++;
      if (severity < 3) { agg.toOrder++; agg.orderCost += suggested * p.price; }
      if (p.stock === 0) agg.outOfStock++;
      brandAgg.set(p.brandId, agg);
    }

    const { section, group } = classify(p.name, pathOf(p.categoryId));
    if (!sections.has(section)) sections.set(section, new Map());
    const groups = sections.get(section)!;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({
      id: p.id, sku: p.sku, name: p.name, brandName: p.brand?.name ?? "—",
      price: p.price, stock: p.stock, expensive, threshold, severity,
      sold90, perMonth: Math.round(perMonth * 10) / 10, daysLeft, suggested,
    });
  }

  const sectionList: LowStockSection[] = [...sections.entries()]
    .sort((a, b) => SECTION_ORDER.indexOf(a[0]) - SECTION_ORDER.indexOf(b[0]))
    .map(([name, groups]) => {
      const groupList: LowStockGroup[] = [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "uk"))
        .map(([gName, items]) => {
          // Пекуче вгорі, далі — те, що швидше закінчиться, далі — дорожче.
          items.sort((a, b) =>
            a.severity !== b.severity
              ? a.severity - b.severity
              : (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9) || b.sold90 - a.sold90 || b.price - a.price,
          );
          return {
            name: gName,
            total: items.length,
            toOrder: items.filter((i) => i.severity < 3).length,
            items,
          };
        });
      return {
        name,
        total: groupList.reduce((s, g) => s + g.total, 0),
        toOrder: groupList.reduce((s, g) => s + g.toOrder, 0),
        groups: groupList,
      };
    });

  return {
    brand,
    params: {
      expensivePrice: params.expensivePrice, expensiveMin: params.expensiveMin,
      cheapMin: params.cheapMin, includeDead: params.includeDead, search: params.search,
    },
    velocityDays: VELOCITY_DAYS,
    total: goods.length,
    toOrder,
    zeroStock,
    urgent,
    orderCost: Math.round(orderCost),
    hiddenDead,
    noPrice,
    brands: [...brandAgg.values()].sort((a, b) => b.toOrder - a.toOrder || b.outOfStock - a.outOfStock),
    sections: sectionList,
  };
}
