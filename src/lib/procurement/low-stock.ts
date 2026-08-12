import { prisma } from "@/lib/prisma";

/**
 * Звіт закупівельника: чого мало на складі по бренду.
 *
 * Пороги «мало» залежать від ціни, а не від категорії: дорога техніка
 * (≥ expensivePrice) обертається одиницями — дефіцит це < expensiveMin шт;
 * дешева оснастка йде пачками — дефіцит це < cheapMin шт. Значення за
 * замовчуванням підібрані по Grösser, але закупівельник може міняти їх
 * у формі — тому всі три параметри наскрізні.
 *
 * Групування — за ієрархією номенклатури 1С. Проблема: у частини товарів
 * категорія — звалище («Імпорт з 1С», «1972»), дерева там немає. Для них
 * групу відновлюємо за назвою товару: словник нижче — це загальні назви
 * інструменту (шуруповерт, болгарка, ланцюг…), тож правила працюють для
 * будь-якого бренду, не лише Grösser.
 */

export type LowStockParams = {
  brandId: string;
  /** Ціна, від якої товар вважається «дорогим» (грн). */
  expensivePrice: number;
  /** Мінімальний залишок для дорогих. */
  expensiveMin: number;
  /** Мінімальний залишок для кількісних. */
  cheapMin: number;
};

export const DEFAULT_PARAMS = { expensivePrice: 1000, expensiveMin: 5, cheapMin: 10 };

export type LowStockItem = {
  id: string;
  sku: string | null;
  name: string;
  price: number;
  stock: number;
  expensive: boolean;
  threshold: number;
  /** 0 — залишок нуль, 1 — нижче норми, 2 — ок. */
  severity: 0 | 1 | 2;
};

export type LowStockGroup = { name: string; total: number; toOrder: number; items: LowStockItem[] };
export type LowStockSection = { name: string; total: number; toOrder: number; groups: LowStockGroup[] };

export type LowStockReport = {
  brand: { id: string; name: string };
  params: Omit<LowStockParams, "brandId">;
  total: number;
  toOrder: number;
  zeroStock: number;
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
  [/диск з победіт|диск пильний|пильний диск/i, SEC.ROZ, "Пильні диски"],
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

export async function buildLowStockReport(params: LowStockParams): Promise<LowStockReport | null> {
  const brand = await prisma.brand.findUnique({ where: { id: params.brandId }, select: { id: true, name: true } });
  if (!brand) return null;

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { brandId: params.brandId, isActive: true },
      select: { id: true, sku: true, name: true, price: true, stock: true, categoryId: true },
    }),
    prisma.category.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const pathOf = (id: string): string[] => {
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
    return parts;
  };

  // Сервісні позиції «РЕМОНТ …» — не товар, який замовляють у постачальника.
  const goods = products.filter((p) => !/^РЕМОНТ/i.test(p.name.trim()));

  const sections = new Map<string, Map<string, LowStockItem[]>>();
  let toOrder = 0;
  let zeroStock = 0;

  for (const p of goods) {
    // Ціна 0 — це «ціна не приїхала з 1С», а не дешевий товар (див.
    // [[product-grouping-brand-not-category]]: 486 позицій без ціни).
    // Рахувати таке за кількісний товар з нормою 10 шт — це вигадати
    // дефіцит там, де про товар просто нічого не відомо.
    const priceKnown = p.price > 0;
    const expensive = p.price >= params.expensivePrice;
    const threshold = expensive ? params.expensiveMin : params.cheapMin;
    const severity: 0 | 1 | 2 =
      p.stock === 0 ? 0 : !priceKnown ? 2 : p.stock < threshold ? 1 : 2;
    if (severity < 2) toOrder++;
    if (severity === 0) zeroStock++;

    const { section, group } = classify(p.name, pathOf(p.categoryId));
    if (!sections.has(section)) sections.set(section, new Map());
    const groups = sections.get(section)!;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({
      id: p.id, sku: p.sku, name: p.name, price: p.price, stock: p.stock,
      expensive, threshold, severity,
    });
  }

  const sectionList: LowStockSection[] = [...sections.entries()]
    .sort((a, b) => SECTION_ORDER.indexOf(a[0]) - SECTION_ORDER.indexOf(b[0]))
    .map(([name, groups]) => {
      const groupList: LowStockGroup[] = [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "uk"))
        .map(([gName, items]) => {
          // Дефіцит угорі: спочатку нулі й найменші залишки, дорожче — вище.
          items.sort((a, b) =>
            a.severity !== b.severity ? a.severity - b.severity : a.stock - b.stock || b.price - a.price,
          );
          return {
            name: gName,
            total: items.length,
            toOrder: items.filter((i) => i.severity < 2).length,
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
    params: { expensivePrice: params.expensivePrice, expensiveMin: params.expensiveMin, cheapMin: params.cheapMin },
    total: goods.length,
    toOrder,
    zeroStock,
    sections: sectionList,
  };
}
