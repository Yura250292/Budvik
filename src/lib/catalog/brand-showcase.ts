/**
 * Вітрина брендів на головній.
 *
 * Бренд — головний вимір цього каталогу (див. brand-tree.ts), але на вітрині
 * він досі виглядав як рядок дрібних плиток із написами Arial: у нас пʼять
 * справжніх логотипів на 359 брендів, і сітка «логотипів» здебільшого показує
 * заглушки. Замість неї — вісім банерів із фотографіями справжнього товару з
 * фірмових каталогів: покупець бачить, що саме стоїть за назвою, ще до кліку.
 *
 * Склад вітрини заведено руками, як і розділи каталогу (SectionDef у
 * classify.ts). Автоматичний вибір «топ-8 за кількістю» тут не працює: у
 * списку опинялися б бренди без жодного фото і без опису, а вітрина — це
 * обіцянка, за яку хтось відповідає.
 */

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CATALOG_CACHE_TAG, getBrandTree } from "@/lib/catalog/brand-tree";

/**
 * Власне сховище знімків. Усе поза ним живе на чужих сайтах і може зникнути
 * або закритись від гарячих посилань: sigma.ua віддає оптимізатору Next 400,
 * тобто замість фото в банері висіла б піктограма битого зображення. У
 * next.config.ts дозволено рівно два хости, і це один із них.
 */
const OWN_IMAGE_PREFIX = "https://files.budvik27.com/";

/** Скільки знімків збираємо на бренд: більше за три у великий банер не влазить. */
const COLLAGE_SIZE = 4;

export interface ShowcaseDef {
  /** Brand.slug у базі — ключ злиття з деревом брендів. */
  slug: string;
  /** Чим бренд є для покупця. Рядок під назвою, а не гасло. */
  tagline: string;
  /**
   * Тон банера. Переважує Brand.color навмисно: у базі колір бренда — це
   * здебільшого колір із палітри аналітики (див. assign-brand-colors.ts), а
   * вітрині потрібен фірмовий і читабельний.
   */
  accent: string;
  /** Великий банер чи компактна картка. */
  tier: "large" | "medium";
  /**
   * Закріплені артикули для колажу. Порожньо — беремо автоматично (див.
   * pickCollage). Заповнювати варто тоді, коли автовибір показує не те
   * обличчя бренда, яке потрібне.
   */
  pins?: string[];
}

/**
 * Склад вітрини. Порядок тут — порядок на екрані.
 *
 * Кольори підібрані так, щоб сусідні банери не зливались і щоб напис на
 * кожному проходив 4,5:1 (перевіряє tests/e2e/home-brand-showcase.spec.ts).
 * Слогани описують те, що в бренді справді лежить у наявності, — звірено з
 * видачею каталогу, а не з рекламою виробника.
 */
export const SHOWCASE: ShowcaseDef[] = [
  {
    slug: "total",
    tagline: "Інструмент, оснастка й техніка для майстерні",
    // Чорний із помаранчевим логотипом — фірмова пара TOTAL. Заодно розводить
    // його з APRO, який теж помаранчевий.
    accent: "#1C1917",
    tier: "large",
    /*
     * Автовибір ставив першим сейф — велику чорну коробку, яка на чорному
     * банері зникає. Тут трійка з різними формами й тонами: пістолет,
     * дерев'яний кейс і стійка з викрутками.
     *
     * Усі знімки TOTAL — з фірмового каталогу, з домальованими підписами
     * характеристик просто на фото. Власних знімків цього бренда в нас немає
     * жодного, тож вибирати доводиться не «з підписом чи без», а який товар
     * виглядає переконливіше.
     */
    pins: ["TAT10605", "TACSR1121", "THT250626"],
  },
  {
    slug: "polax",
    tagline: "Ручний інструмент і набори для дому й майстерні",
    accent: "#0B5ED7",
    tier: "large",
  },
  {
    slug: "grosser",
    tagline: "Садова техніка та зварювальне обладнання",
    accent: "#14804F",
    tier: "large",
  },
  {
    slug: "apro",
    tagline: "Електро- і пневмоінструмент, генератори, компресори",
    accent: "#EB6834",
    tier: "large",
  },
  {
    slug: "unifix",
    tagline: "Монтажна хімія, кріплення та пакування",
    accent: "#1A5276",
    tier: "medium",
  },
  {
    slug: "aurora",
    tagline: "Замки, циліндри та фурнітура",
    accent: "#6C3483",
    tier: "medium",
  },
  {
    slug: "sigma",
    tagline: "Оснастка, пневматика й інструмент для СТО",
    accent: "#007A2F",
    tier: "medium",
  },
  {
    slug: "syla",
    tagline: "Автотовари, відпочинок і слюсарний інструмент",
    accent: "#B03A2E",
    tier: "medium",
  },
];

export const SHOWCASE_BY_SLUG = new Map(SHOWCASE.map((d) => [d.slug, d]));

/** Бренд вітрини — те, що потрібно банеру, і нічого зайвого. */
export interface ShowcaseBrand {
  slug: string;
  name: string;
  tagline: string;
  accent: string;
  tier: "large" | "medium";
  /** Логотип, якщо він у нас справжній; інакше банер малює напис. */
  logoUrl: string | null;
  /** Скільки товарів бренда покупець побачить на його сторінці. */
  count: number;
  /** Знімки для колажу — 0…4 адреси з власного сховища. */
  photos: string[];
}

type Candidate = { image: string | null; typeKey: string | null; sku: string | null };

/**
 * Колаж бренда — різні товари, а не чотири однакові.
 *
 * Наївне «перші за id» давало UNIFIX сім разів те саме фото ізострічки, а СИЛІ
 * — чотири майже однакові компресори: у 1С сусідні артикули це варіанти одного
 * товару, які часто ще й ділять один знімок. Тому: спершу по одному товару на
 * групу (Product.typeKey — та сама колонка, якою фільтрує каталог), дорожчі
 * першими (флагман бренда виглядає переконливіше за скотч за 10 ₴), і лише
 * потім добираємо рештою, якщо груп забракло — як в AURORA, де майже все це
 * «замок».
 */
function pickCollage(candidates: Candidate[]): string[] {
  const photos: string[] = [];
  const seenImage = new Set<string>();
  const seenType = new Set<string>();

  for (const c of candidates) {
    if (!c.image || seenImage.has(c.image)) continue;
    if (c.typeKey && seenType.has(c.typeKey)) continue;
    if (c.typeKey) seenType.add(c.typeKey);
    seenImage.add(c.image);
    photos.push(c.image);
    if (photos.length === COLLAGE_SIZE) return photos;
  }

  for (const c of candidates) {
    if (!c.image || seenImage.has(c.image)) continue;
    seenImage.add(c.image);
    photos.push(c.image);
    if (photos.length === COLLAGE_SIZE) break;
  }

  return photos;
}

/**
 * Знімки й лічильники вітрини.
 *
 * Кешується окремо від дерева брендів і містить лише те, що дорого рахувати.
 *
 * Лічильник рахуємо тут, а не беремо з getBrandTree, попри те що дерево вже
 * кешоване: воно рахує всі активні картки, а сторінка бренда показує лише
 * наявне з ціною. Для SIGMA це 3202 проти 1606 — банер обіцяв би вдвічі
 * більше, ніж покупець побачить за кліком. Умова тут навмисно та сама, що в
 * buildWhere() для /brand/[slug]: isActive + price > 0 + stock > 0.
 */
const getShowcaseData = unstable_cache(
  async (): Promise<Record<string, { count: number; photos: string[] }>> => {
    /*
     * Закріплені артикули б'ють автовибір. Наявність для них не вимагається:
     * знімок працює ілюстрацією бренда, а не пропозицією товару, — інакше
     * обличчя банера мінялося б щоразу, коли ходову позицію розберуть.
     *
     * findMany, а не findUnique: артикули в 1С не унікальні (дублі з хвостом
     * -xxxxxx), тож беремо перший за id — той самий після кожного протухання
     * кешу.
     */
    const pins = SHOWCASE.flatMap((d) => d.pins ?? []);
    const pinned = pins.length
      ? await prisma.product.findMany({
          where: {
            sku: { in: pins },
            isActive: true,
            image: { startsWith: OWN_IMAGE_PREFIX },
          },
          select: { sku: true, image: true },
          orderBy: { id: "asc" },
        })
      : [];
    const bySku = new Map<string, string>();
    for (const p of pinned) if (p.sku && p.image && !bySku.has(p.sku)) bySku.set(p.sku, p.image);

    const entries = await Promise.all(
      SHOWCASE.map(async (def) => {
        const shoppable = {
          isActive: true,
          stock: { gt: 0 },
          price: { gt: 0 },
          brand: { slug: def.slug },
        } as const;

        const [count, candidates] = await Promise.all([
          prisma.product.count({ where: shoppable }),
          prisma.product.findMany({
            where: { ...shoppable, image: { startsWith: OWN_IMAGE_PREFIX } },
            select: { image: true, typeKey: true, sku: true },
            /*
             * Дорожчі першими, за ними — стабільний порядок за id. Priority
             * тут не сортує нічого: у цих брендів він скрізь нульовий, а от
             * ціна впорядковує саме так, як треба вітрині.
             */
            orderBy: [{ price: "desc" }, { id: "asc" }],
            take: 80,
          }),
        ]);

        const pinnedPhotos = (def.pins ?? [])
          .map((sku) => bySku.get(sku))
          .filter((v): v is string => Boolean(v));

        const photos = [
          ...pinnedPhotos,
          ...pickCollage(candidates).filter((p) => !pinnedPhotos.includes(p)),
        ].slice(0, COLLAGE_SIZE);

        return [def.slug, { count, photos }] as const;
      })
    );

    return Object.fromEntries(entries);
  },
  ["home-brand-showcase-v1"],
  { revalidate: 3600, tags: [CATALOG_CACHE_TAG] }
);

/**
 * Бренди вітрини — склад, назви з бази, логотипи, лічильники й знімки.
 *
 * Звичайна функція поверх двох кешів, а не третій кеш: обгортати кеш кешем
 * означало б дві копії тих самих чисел із різним часом протухання (див.
 * getSectionTiles — там це вже коштувало розбіжності «430» і «1188»).
 *
 * Бренд, якого немає в базі або в якого нічого не лишилось у наявності, тихо
 * випадає з вітрини: порожній банер гірший за його відсутність.
 */
export async function getBrandShowcase(): Promise<ShowcaseBrand[]> {
  const [tree, data] = await Promise.all([getBrandTree(), getShowcaseData()]);

  const bySlug = new Map(tree.main.concat(tree.tail).map((b) => [b.slug, b]));

  return SHOWCASE.flatMap((def) => {
    const node = bySlug.get(def.slug);
    const live = data[def.slug];
    if (!node || !live || live.count === 0) return [];

    return [
      {
        slug: node.slug,
        name: node.name,
        tagline: def.tagline,
        accent: def.accent,
        tier: def.tier,
        logoUrl: node.logoUrl,
        count: live.count,
        photos: live.photos,
      },
    ];
  });
}
