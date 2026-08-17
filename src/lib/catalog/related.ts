import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { showableProductWhere } from "./showable";

/**
 * Зв'язки між типами товарів для блоків рекомендацій.
 *
 * Категорії з 1С для цього не годяться: 84% позицій лежать у звалищі
 * «Імпорт з 1С», тож «товари з тієї ж категорії» — це випадкові 40 тисяч
 * позицій. Єдине, що реально описує товар, — його назва, тому тип
 * розпізнаємо за ключовими словами і по них же шукаємо пару.
 *
 * `keywords` працює у два боки: ними ж і розпізнаємо тип, і шукаємо товари
 * цього типу в базі через `contains`.
 */
export interface ProductType {
  key: string;
  label: string;
  keywords: string[];
  /** Слова, які скасовують збіг: «акумулятор» ≠ «акумулятор автомобільний». */
  exclude?: string[];
  /** Типи, які доповнюють цей товар: інструмент ↔ оснастка ↔ витратне. */
  goesWith: string[];
}

/**
 * Порядок має значення: розпізнавання бере ПЕРШИЙ збіг, тож оснастка йде
 * перед інструментом. Інакше «Круг відрізний для болгарки» визначився б як
 * болгарка, і людині запропонували б круги замість інструмента.
 */
export const PRODUCT_TYPES: ProductType[] = [
  {
    key: "cutting-disc",
    label: "Круги відрізні",
    keywords: ["круг відрізний", "диск відрізний", "відрізний круг", "коло відрізне"],
    goesWith: ["grinder", "grinding-disc", "flap-disc", "safety"],
  },
  {
    key: "grinding-disc",
    label: "Круги шліфувальні",
    keywords: ["круг шліфувальний", "круг зачисний", "диск шліфувальний", "круг обдирний"],
    goesWith: ["grinder", "cutting-disc", "safety"],
  },
  {
    key: "flap-disc",
    label: "Круги пелюсткові",
    keywords: ["пелюстков", "лепестков"],
    goesWith: ["grinder", "cutting-disc", "safety"],
  },
  {
    key: "diamond-disc",
    label: "Диски алмазні",
    keywords: ["алмазний диск", "диск алмазний", "круг алмазний"],
    goesWith: ["grinder", "safety"],
  },
  {
    key: "saw-blade",
    label: "Диски пиляльні",
    keywords: ["пиляльний диск", "диск пиляльний", "диск по дереву", "пильний диск"],
    goesWith: ["circular-saw", "safety"],
  },
  {
    // Перед звичайними свердлами: «Свердло для бетону SDS-plus» — оснастка
    // перфоратора, а не дриля, тож і пару йому треба перфораторну.
    key: "sds-bit",
    label: "Бури і зубила",
    keywords: ["бур по бетону", "бур для бетону", "бури для бетону", "sds-plus", "sds plus", "sds-max", "зубило", "пробійник"],
    goesWith: ["rotary-hammer", "safety"],
  },
  {
    key: "drill-bit",
    label: "Свердла",
    keywords: ["свердло", "свердла"],
    goesWith: ["drill", "screwdriver", "bit"],
  },
  {
    key: "bit",
    label: "Біти і насадки",
    keywords: ["біт ", "біти", "набір біт", "насадка pz", "насадка ph"],
    goesWith: ["screwdriver", "drill-bit"],
  },
  {
    key: "chain",
    label: "Ланцюги і шини",
    keywords: ["ланцюг для пил", "ланцюг пил", "шина для пил", "шина пил", "ланцюг 3/8"],
    goesWith: ["chainsaw", "chain-oil", "file"],
  },
  {
    key: "chain-oil",
    label: "Мастила",
    keywords: ["олива для ланцюг", "мастило для ланцюг", "олива ланцюг", "двотактн"],
    goesWith: ["chainsaw", "chain"],
  },
  {
    key: "trimmer-line",
    label: "Ліска і ножі для тримера",
    keywords: ["ліска", "косильна головка", "ніж для тример"],
    goesWith: ["trimmer"],
  },
  {
    key: "sandpaper",
    label: "Шліфпапір",
    keywords: ["шліфпапір", "наждачн", "шліфувальна шкурка", "шліфувальний папір"],
    goesWith: ["sander", "grinder"],
  },
  {
    key: "battery",
    label: "Акумулятори і зарядні",
    keywords: ["акумулятор ", "акб ", "зарядний пристрій"],
    exclude: ["автомобільн", "пусков", "стартерн", "гелев", "тягов"],
    goesWith: ["screwdriver", "drill"],
  },
  {
    key: "grinder",
    label: "Кутові шліфмашини",
    // «КШМ» навмисно немає: у базі це слово трапляється лише в аксесуарах
    // («Кожух накладний на КШМ», «Щітка коло … (КШМ)»), і болгаркою
    // помилково ставав кожух.
    keywords: [
      "болгарка",
      "машина шліфувальна кутова",
      "кутова шліфувальна машина",
      "шліфмашина кутова",
      "кутошліфувальна",
    ],
    goesWith: ["cutting-disc", "grinding-disc", "flap-disc", "safety"],
  },
  {
    key: "rotary-hammer",
    label: "Перфоратори",
    keywords: ["перфоратор"],
    goesWith: ["sds-bit", "safety"],
  },
  {
    key: "screwdriver",
    label: "Шуруповерти",
    keywords: ["шуруповерт", "гвинтоверт"],
    goesWith: ["bit", "drill-bit", "battery"],
  },
  {
    key: "drill",
    label: "Дрилі",
    keywords: ["дриль", "дрель"],
    goesWith: ["drill-bit", "bit"],
  },
  {
    key: "chainsaw",
    label: "Пили ланцюгові",
    keywords: ["бензопила", "ланцюгова пила", "електропила", "пила ланцюгова"],
    goesWith: ["chain", "chain-oil", "safety"],
  },
  {
    key: "circular-saw",
    label: "Пили дискові",
    keywords: ["пила дискова", "дискова пила", "циркулярна пила"],
    goesWith: ["saw-blade", "safety"],
  },
  {
    key: "sander",
    label: "Шліфмашини",
    keywords: ["шліфмашина", "шліфувальна машина", "ексцентрикова"],
    goesWith: ["sandpaper"],
  },
  {
    key: "trimmer",
    label: "Тримери",
    keywords: ["тример", "мотокоса", "газонокосарка"],
    goesWith: ["trimmer-line", "chain-oil", "safety"],
  },
  {
    key: "safety",
    label: "Засоби захисту",
    keywords: ["окуляри захисн", "щиток захисн", "рукавиц", "навушники захисн", "респіратор", "маска зварювальн"],
    goesWith: [],
  },
];

const BY_KEY = new Map(PRODUCT_TYPES.map((t) => [t.key, t]));

/** Тип товару за назвою; null — якщо назва ні під що не підходить. */
/**
 * У назвах з 1С трапляється латиниця замість кирилиці («Лiска для тримера»
 * через латинську i). Без цього такий товар не впізнається як ліска й
 * помилково зараховується до тримерів — за словом «тримера» в назві.
 * Міняємо лише ті латинські літери, що стоять упритул до кирилиці, щоб не
 * зачепити англійські назви на кшталт SIGMA чи HSS.
 */
const HOMOGLYPHS: Record<string, string> = {
  i: "і", a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у",
};
const CYRILLIC = /[Ѐ-ӿ]/;

export function normalizeName(name: string): string {
  const chars = [...name.toLowerCase()];
  return chars
    .map((ch, i) => {
      const swap = HOMOGLYPHS[ch];
      if (!swap) return ch;
      const prev = chars[i - 1] ?? "";
      const next = chars[i + 1] ?? "";
      return CYRILLIC.test(prev) || CYRILLIC.test(next) ? swap : ch;
    })
    .join("");
}

export function detectProductType(name: string): ProductType | null {
  const lower = ` ${normalizeName(name)} `;
  return (
    PRODUCT_TYPES.find(
      (t) =>
        t.keywords.some((k) => lower.includes(k.toLowerCase())) &&
        !t.exclude?.some((k) => lower.includes(k.toLowerCase()))
    ) ?? null
  );
}

function keywordsFilter(types: ProductType[]): Prisma.ProductWhereInput {
  return {
    OR: types.flatMap((t) =>
      t.keywords.map((k) => ({ name: { contains: k, mode: "insensitive" as const } }))
    ),
  };
}

type Candidate = { id: string; name: string; slug: string; price: number; image: string | null; brandId: string | null };

const SELECT = { id: true, name: true, slug: true, price: true, image: true, brandId: true } as const;

/**
 * Перемішує так, щоб поспіль не йшли товари одного бренда: інакше «інші
 * розміри» вироджуються в чотири позиції однієї лінійки, як було до цього.
 */
function roundRobinByBrand(items: Candidate[], take: number): Candidate[] {
  const buckets = new Map<string, Candidate[]>();
  for (const it of items) {
    const key = it.brandId ?? "none";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(it);
  }
  const queues = [...buckets.values()];
  const out: Candidate[] = [];
  while (out.length < take && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
      if (out.length >= take) break;
    }
  }
  return out;
}

/**
 * Товари того ж типу — інші розміри й інші виробники.
 * Спершу чужі бренди, щоб добірка не була однією лінійкою.
 */
export async function findSameType(
  product: { id: string; name: string; brandId: string | null },
  take = 4
): Promise<Candidate[]> {
  const type = detectProductType(product.name);
  if (!type) return [];

  const candidates = await prisma.product.findMany({
    where: {
      ...showableProductWhere(),
      id: { not: product.id },
      ...keywordsFilter([type]),
    },
    select: SELECT,
    orderBy: [{ stock: "desc" }, { price: "asc" }],
    take: 60,
  });

  // Перевіряємо тип ще раз уже за назвою знайденого: пошук у базі не знає про
  // мінус-слова, тож без цього в «схожі» пролазить, скажімо, кожух на КШМ.
  const ofType = candidates.filter((c) => detectProductType(c.name)?.key === type.key);
  const other = ofType.filter((c) => c.brandId !== product.brandId);
  const same = ofType.filter((c) => c.brandId === product.brandId);
  return [...roundRobinByBrand(other, take), ...same].slice(0, take);
}

/**
 * Супутні товари: до круга — болгарка й захист, до болгарки — круги,
 * до бура — перфоратор. Беремо по черзі з кожного типу-компаньйона, щоб у
 * четвірці був і інструмент, і витратне, а не чотири однакові позиції.
 */
export async function findComplementary(
  product: { id: string; name: string },
  take = 4
): Promise<Candidate[]> {
  const type = detectProductType(product.name);
  if (!type || type.goesWith.length === 0) return [];

  const companions = type.goesWith.map((k) => BY_KEY.get(k)).filter((t): t is ProductType => !!t);
  if (companions.length === 0) return [];

  const candidates = await prisma.product.findMany({
    where: {
      ...showableProductWhere(),
      id: { not: product.id },
      ...keywordsFilter(companions),
    },
    select: SELECT,
    orderBy: [{ stock: "desc" }, { price: "asc" }],
    take: 80,
  });

  // Розкладаємо по типах-компаньйонах і беремо по черзі: перший компаньйон у
  // списку goesWith найважливіший (для круга це болгарка), тож він іде першим.
  const byType = new Map<string, Candidate[]>(companions.map((c) => [c.key, []]));
  for (const c of candidates) {
    const t = detectProductType(c.name);
    if (t && byType.has(t.key)) byType.get(t.key)!.push(c);
  }

  const out: Candidate[] = [];
  const queues = companions.map((c) => byType.get(c.key)!);
  while (out.length < take && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
      if (out.length >= take) break;
    }
  }
  return out;
}
