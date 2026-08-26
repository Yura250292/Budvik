import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CATALOG_CACHE_TAG } from "@/lib/catalog/brand-tree";
import { SECTIONS, SECTION_BY_ID, TYPE_LABELS } from "@/lib/catalog/classify";

/**
 * Зміст каталогу за призначенням — як у паперових каталогах постачальників.
 *
 * Бренд лишається робочим фільтром, але шукати ним товар незручно: клієнт
 * питає «а валики є?», а не «а що є в YATO». У паперовому каталозі, який
 * торговий возить у машині, зміст побудований саме так: розділ «Малярний
 * інструмент» — і під ним валики, пензлі, ванни, мішалки.
 *
 * Розділи й групи рахуються з колонок Product.sectionId / Product.typeKey,
 * які проставляє класифікатор (lib/catalog/classify.ts). Раніше зміст рахував
 * групу в пам'яті за першим словом назви, а фільтр каталогу шукав те слово
 * підрядком — два різні способи на тих самих даних, тож число під назвою
 * розділу не могло збігтися з видачею за посиланням.
 */

export type { SectionDef } from "@/lib/catalog/classify";
export { SECTIONS } from "@/lib/catalog/classify";

export interface TocLine {
  /** Значення для ?type= */
  key: string;
  label: string;
  count: number;
}

export interface TocSection {
  id: string;
  title: string;
  icon: string;
  lines: TocLine[];
  total: number;
  /** Групи розділу — ті, що потрапили в рядки змісту. */
  types: string[];
}

/** Скільки товарів має мати група, щоб потрапити в зміст окремим рядком. */
const MIN_LINE = 5;

/**
 * Зміст: розділи з рядками-групами й кількістю товарів.
 *
 * Рахуємо один раз на годину (і на кожен обмін з 1С — той скидає тег): це
 * один GROUP BY, але сторінка вітрини не мусить ходити в базу за ним на
 * кожен показ.
 */
export const getCatalogToc = unstable_cache(
  async (): Promise<{ sections: TocSection[]; other: TocLine[]; total: number }> => {
    /*
     * Рахуємо лише те, що каталог справді покаже.
     *
     * stock > 0 — бо каталог за замовчуванням віддає лише наявне (buildWhere
     * додає це, доки не ввімкнено «Показати відсутні»); price > 0 — бо обмін
     * бере роздріб лише з типу цін «6.МАГАЗИНИ», і де його не ведуть, товар
     * приїжджає з нулем, а такі рядки каталог не показує. Число під назвою
     * розділу мусить збігатися з тим, що побачить людина, інакше воно гірше
     * за відсутнє.
     */
    const rows = await prisma.product.groupBy({
      by: ["sectionId", "typeKey"],
      where: { isActive: true, stock: { gt: 0 }, price: { gt: 0 }, typeKey: { not: null } },
      _count: { _all: true },
    });

    const total = await prisma.product.count({
      where: { isActive: true, stock: { gt: 0 }, price: { gt: 0 } },
    });

    const bySection = new Map<string, TocLine[]>();
    /**
     * Скільки товарів у розділі насправді — разом із дрібними групами, які
     * окремим рядком не показуємо.
     *
     * Раніше підсумок був сумою показаних рядків, і число під назвою розділу
     * виходило на 2–8 позицій меншим за видачу за посиланням. Дрібниця, але
     * саме такі дрібниці й привчають не вірити числам на сайті.
     */
    const totalBySection = new Map<string, number>();
    const orphans: TocLine[] = [];

    for (const r of rows) {
      if (r.sectionId) {
        totalBySection.set(r.sectionId, (totalBySection.get(r.sectionId) || 0) + r._count._all);
      }
      const line: TocLine = {
        key: r.typeKey!,
        label: TYPE_LABELS[r.typeKey!] ?? r.typeKey!,
        count: r._count._all,
      };
      if (line.count < MIN_LINE) continue;
      // Розділ, якого більше немає в означеннях (правила переписали, а база
      // ще з попереднім прогоном), — не привід ховати товар зі змісту.
      if (!r.sectionId || !SECTION_BY_ID.has(r.sectionId)) {
        orphans.push(line);
        continue;
      }
      if (!bySection.has(r.sectionId)) bySection.set(r.sectionId, []);
      bySection.get(r.sectionId)!.push(line);
    }

    const sections: TocSection[] = [];
    for (const def of SECTIONS) {
      const lines = bySection.get(def.id);
      if (!lines?.length) continue;
      lines.sort((a, b) => b.count - a.count);
      sections.push({
        id: def.id,
        title: def.title,
        icon: def.icon,
        lines,
        total: totalBySection.get(def.id) ?? lines.reduce((s, l) => s + l.count, 0),
        types: lines.map((l) => l.key),
      });
    }

    orphans.sort((a, b) => b.count - a.count);
    return { sections, other: orphans.slice(0, 60), total };
  },
  ["catalog-toc-v2"],
  { revalidate: 3600, tags: [CATALOG_CACHE_TAG] }
);

/**
 * Власне сховище знімків. Усе, що поза ним, живе на чужих сайтах і може
 * зникнути або закритись від гарячих посилань будь-якої миті.
 */
const OWN_IMAGE_PREFIX = "https://files.budvik27.com/";

/** Розділ із фотографією справжнього товару — для банерів і плиток на головній. */
export interface SectionTile {
  id: string;
  title: string;
  /** Посилання на весь розділ у каталозі. */
  href: string;
  count: number;
  /** Фото товару з розділу; null, якщо в розділі немає жодного з фото. */
  image: string | null;
  /** Що лежить у розділі — рядком під назвою. */
  summary: string;
  /** Тон банера розділу. */
  tint: string;
  /** Великий банер (true) чи дрібна плитка (false). */
  featured: boolean;
}

/**
 * Знімок товару для кожного розділу.
 *
 * Кешується окремо від змісту й містить **тільки** посилання на фото. Спершу
 * тут лежали готові плитки разом із назвою та лічильником — і два кеші почали
 * розходитись: рейка розділів брала число зі змісту, плитки — зі своєї копії,
 * тож під однаковими назвами стояли «430» і «1188». Число мусить мати одне
 * джерело; дублювати варто лише те, що дорого рахувати, а це саме пошук фото.
 */
const getSectionImages = unstable_cache(
  async (): Promise<Record<string, string | null>> => {
    /*
     * Закріплені артикули (SectionDef.hero) б'ють будь-який автоматичний
     * вибір. Наявність тут не вимагається навмисно: фото працює ілюстрацією
     * розділу, а не пропозицією товару — банер веде в каталог, а не на
     * картку. Інакше обличчя розділу мінялося б щоразу, коли ходовий товар
     * розберуть до наступного постачання.
     *
     * findMany, а не findUnique: артикули в 1С не унікальні (дублі з хвостом
     * -xxxxxx), тож беремо перший за id — той самий після кожного протухання
     * кешу.
     */
    const pins = SECTIONS.map((s) => s.hero).filter((v): v is string => Boolean(v));
    const pinned = pins.length
      ? await prisma.product.findMany({
          where: { sku: { in: pins }, isActive: true, image: { not: null }, NOT: { image: "" } },
          select: { sku: true, image: true },
          orderBy: { id: "asc" },
        })
      : [];
    const bySku = new Map<string, string>();
    for (const p of pinned) if (p.sku && p.image && !bySku.has(p.sku)) bySku.set(p.sku, p.image);

    /*
     * Знімок для розділу без закріпленого артикула — з товару того ж розділу.
     *
     * Порядок за id — щоб переможець був той самий після кожного протухання
     * кешу: знак, який змінюється сам собою, перестає бути знаком.
     */
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        stock: { gt: 0 },
        price: { gt: 0 },
        sectionId: { not: null },
        image: { not: null },
        NOT: { image: "" },
      },
      select: { sectionId: true, image: true },
      orderBy: { id: "asc" },
    });

    const bySection = new Map<string, string>();
    for (const p of products) {
      if (!p.sectionId || !p.image) continue;
      /**
       * Знімок із власного сховища б'є будь-який інший, навіть якщо трапився
       * пізніше. Поле image — довільний https-адрес, і частина посилань веде
       * на сайти постачальників, які закривають гарячі посилання: sigma.ua
       * віддає оптимізатору Next 400, тобто плитка лишається з піктограмою
       * битого зображення.
       */
      const current = bySection.get(p.sectionId);
      if (!current) bySection.set(p.sectionId, p.image);
      else if (p.image.startsWith(OWN_IMAGE_PREFIX) && !current.startsWith(OWN_IMAGE_PREFIX)) {
        bySection.set(p.sectionId, p.image);
      }
    }

    return Object.fromEntries(
      SECTIONS.map((s) => {
        const pinnedImage = s.hero ? bySku.get(s.hero) : undefined;
        return [s.id, pinnedImage ?? bySection.get(s.id) ?? null];
      })
    );
  },
  ["catalog-section-images-v2"],
  { revalidate: 3600, tags: [CATALOG_CACHE_TAG] }
);

/** Посилання на весь розділ каталогу. */
export const sectionHref = (id: string) => `/catalog?section=${encodeURIComponent(id)}`;

/**
 * Плитки розділів із фотографією товару замість піктограми.
 *
 * Emoji в ролі іконки виглядає як тимчасова заглушка, а не як навігація: 🎨
 * однаково позначає і фарбу, і дизайн, і свято. Фотографія відповідає на
 * питання «що тут лежить» швидше за будь-який підпис — саме так влаштовані
 * «рекомендовані категорії» у великих магазинах техніки.
 *
 * Назва, лічильник і посилання беруться зі змісту наживо — він і сам кешований,
 * тож виклик дешевий, зате число на плитці не може розійтися з числом у рейці.
 */
export async function getSectionTiles(): Promise<SectionTile[]> {
  const [{ sections }, images] = await Promise.all([getCatalogToc(), getSectionImages()]);

  return sections.map((s) => {
    const def = SECTION_BY_ID.get(s.id);
    return {
      id: s.id,
      title: s.title,
      href: sectionHref(s.id),
      count: s.total,
      image: images[s.id] ?? null,
      summary: def?.summary ?? s.lines.slice(0, 3).map((l) => l.label.toLowerCase()).join(" · "),
      tint: def?.tint ?? "#F2F2F2",
      featured: Boolean(def?.featured),
    };
  });
}
