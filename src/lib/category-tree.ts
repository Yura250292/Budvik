// Auto-grouping categories into a tree structure based on keywords

export interface CategoryGroup {
  name: string;
  icon: string;
  keywords: string[];
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    name: "Електроінструменти",
    icon: "⚡",
    keywords: [
      "дрил", "перфоратор", "болгарк", "шліфмашин", "кутові шліфмашин",
      "лобзик", "електролобзик", "електропил", "циркулярн", "рубанок", "електрорубанк",
      "фрезер", "шуруповерт", "міксер будівельн", "фен будівельн", "будівельні фен",
      "відбійн", "пилосос", "будівельні пилосос", "мийк", "фарбопульт", "електричн",
      "ударні дрил", "ручний електро", "мережеві", "шліфувальні машин",
      "плиткоріз", "степлер", "клейов", "термопістолет",
    ],
  },
  {
    name: "Акумуляторний інструмент",
    icon: "🔋",
    keywords: [
      "акумулятор",
    ],
  },
  {
    name: "Ручний інструмент",
    icon: "🔧",
    keywords: [
      "ключ", "викрутк", "плоскогубц", "пасатиж", "бокоріз", "кліщ",
      "довгогубц", "тонкогубц", "круглогубц", "молоток", "кувалд",
      "стамеск", "зубил", "напилок", "рашпіль", "цикл", "ножиці",
      "ножівк", "пил", "набори інструмент", "набори викрут",
      "набори гайков", "мультитул", "мультиінструмент", "слюсарн",
      "шарнірно-губцев", "ударно-важіль", "монтувалк", "реверсивн",
      "ручний інструмент", "ручні ключі", "струбцин", "лещат",
      "обжимн", "знімач", "лом", "цвяходер", "торцеві головк",
      "перехідник", "кардан", "подовжувач", "вороток",
      "ключі-тріскач", "сантехнічні ключ",
    ],
  },
  {
    name: "Вимірювальний інструмент",
    icon: "📏",
    keywords: [
      "рулетк", "рівн", "лазерн", "косин", "лінійк", "штангенциркул",
      "вимірювальн", "розмічальн", "мультиметр", "фазометр", "манометр",
      "правил",
    ],
  },
  {
    name: "Витратні матеріали",
    icon: "💿",
    keywords: [
      "свердл", "сверл", "бур по бетон", "коронк", "біти", "круг",
      "диск", "наждачн", "абразивн", "пелюстков", "шліфувальн круг",
      "шліфувальн губк", "шліфувальн камен", "шліфувальн блок",
      "полотно для лобзик", "ліска для тример", "ланцюг", "шини для",
      "ножі, диски, котушк", "скоби для степлер", "стрижні клейов",
      "цвях", "заклеп", "фібров", "різ", "ріжучо",
    ],
  },
  {
    name: "Садова техніка",
    icon: "🌿",
    keywords: [
      "садов", "газонокосилк", "тример", "мотокос", "бензопил",
      "бензотример", "бензоінструмент", "кущоріз", "секатор", "гілкоруб",
      "грабл", "лопат", "вил", "сокир", "колун",
      "обприскувач", "оприскувач", "мотооприскувач",
      "комплектуючі для садов", "свічки до бензопил",
      "електро садов", "полив", "зрошен",
    ],
  },
  {
    name: "Насоси та водопостачання",
    icon: "💧",
    keywords: [
      "насос", "помп", "гідроакумулятор", "реле та контролер",
      "розширювальн", "перетворювач частот",
    ],
  },
  {
    name: "Сантехніка",
    icon: "🚿",
    keywords: [
      "змішувач", "сифон", "шланг підводк", "шланг для душ",
      "душов", "лійк", "картридж", "вилив", "ручк для змішувач",
      "донн", "гофр", "сантехнік", "аксесуари для ванн",
    ],
  },
  {
    name: "Зварювальне обладнання",
    icon: "🔥",
    keywords: [
      "зварюваль", "електрод", "дріт до п/авт", "маска зварювальн",
      "маски-", "хамелеон",
    ],
  },
  {
    name: "Пневмоінструмент",
    icon: "🌀",
    keywords: [
      "пневм", "компресор", "фітинги для пневм", "устаткування для підготовк",
      "повітряні компресор",
    ],
  },
  {
    name: "Малярний інструмент",
    icon: "🎨",
    keywords: [
      "валик", "пензл", "шпатель", "малярськ", "малярськ", "малярн",
      "ванночк", "фарб", "аерозольн", "фарборозпилювач",
      "аерограф", "терк",
    ],
  },
  {
    name: "Будівельне обладнання",
    icon: "🏗️",
    keywords: [
      "будівельн", "бетонозмішувач", "генератор", "стабілізатор",
      "обігрівач", "вентилятор", "драбин", "тачк",
      "лебідк", "талі", "піна", "хомут", "будівельна хім",
      "домкрат", "клин", "хрестик",
    ],
  },
  {
    name: "Засоби захисту",
    icon: "🦺",
    keywords: [
      "рукавиц", "рукавичк", "окуляри захисн", "маски захисн",
      "респіратор", "навушник", "спецодяг", "засоби захист",
      "щитк", "каскетк",
    ],
  },
  {
    name: "Автотовари",
    icon: "🚗",
    keywords: [
      "авто", "пускові дрот", "буксирувальн", "омивач", "прикурювач",
      "обладнання для СТО", "зимові щітк",
    ],
  },
  {
    name: "Туризм та відпочинок",
    icon: "⛺",
    keywords: [
      "туристичн", "туризм", "кемпінг", "намет", "термос", "термокруж",
      "термосумк", "мангал", "казан", "коптильн", "сковород",
      "газов", "пальник", "пікнік", "рюкзак",
    ],
  },
  {
    name: "Зберігання інструменту",
    icon: "🧰",
    keywords: [
      "ящик", "сумк", "органайзер", "кишен", "поясн", "тумб",
    ],
  },
  {
    name: "Освітлення",
    icon: "🔦",
    keywords: [
      "ліхтар",
    ],
  },
  {
    name: "Кріплення та метизи",
    icon: "🔩",
    keywords: [
      "кріпильн", "плашк", "мітчик", "хомут", "замк",
      "склодомкрат", "склоріз",
    ],
  },
];

export interface CategoryWithCount {
  id: string;
  name: string;
  slug: string;
  _count: { products: number };
}

export interface GroupedCategory {
  group: string;
  icon: string;
  categories: CategoryWithCount[];
  totalProducts: number;
}

export function groupCategories(categories: CategoryWithCount[]): {
  grouped: GroupedCategory[];
  ungrouped: CategoryWithCount[];
} {
  const assigned = new Set<string>();
  const grouped: GroupedCategory[] = [];

  for (const group of CATEGORY_GROUPS) {
    const matching = categories.filter((cat) => {
      if (assigned.has(cat.id)) return false;
      const nameLower = cat.name.toLowerCase();
      return group.keywords.some((kw) => nameLower.includes(kw.toLowerCase()));
    });

    if (matching.length > 0) {
      matching.forEach((cat) => assigned.add(cat.id));
      // Sort by product count descending
      matching.sort((a, b) => b._count.products - a._count.products);
      grouped.push({
        group: group.name,
        icon: group.icon,
        categories: matching,
        totalProducts: matching.reduce((s, c) => s + c._count.products, 0),
      });
    }
  }

  const ungrouped = categories.filter((cat) => !assigned.has(cat.id));

  // Sort groups by total products descending
  grouped.sort((a, b) => b.totalProducts - a.totalProducts);

  return { grouped, ungrouped };
}

// Extract brand from product name
// Common patterns: "Product Type BRAND Model" or "BRAND Product..."
const KNOWN_BRANDS = [
  "Bosch", "Makita", "DeWalt", "Einhell", "SIGMA", "APRO", "DNIPRO-M",
  "GRAD", "INTERTOOL", "ULTRA", "VOREL", "YATO", "TOPEX", "NEO",
  "STANLEY", "MILWAUKEE", "METABO", "GRAPHITE", "PROLINE", "TOTAL",
  "MASTERTOOL", "HOUSETOOLS", "MIOL", "ALLOID", "STORM", "POWER",
  "TOPTUL", "JONNESWAY", "LICOTA", "KING TONY", "FORCE", "HANS",
  "EXPERT", "REFCO", "VORTEX", "FLORA", "MAESTRO", "VITALS",
  "FORTE", "TITAN", "WERK", "PATRIOT", "COMPASS", "USH",
  "MAROLEX", "KARCHER", "STIHL", "HUSQVARNA", "GROSS", "Grosser",
  "БРИГАДИР", "СИЛА", "ТРИТОН",
];

export function extractBrandsFromProducts(
  products: { name: string }[]
): { brand: string; count: number }[] {
  const brandCounts: Record<string, number> = {};

  for (const product of products) {
    const nameUpper = product.name.toUpperCase();
    for (const brand of KNOWN_BRANDS) {
      if (nameUpper.includes(brand.toUpperCase())) {
        const key = brand.toUpperCase() === brand ? brand : brand;
        brandCounts[key] = (brandCounts[key] || 0) + 1;
        break; // one brand per product
      }
    }
  }

  return Object.entries(brandCounts)
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count);
}
