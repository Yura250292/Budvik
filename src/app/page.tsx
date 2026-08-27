/*
 * Головна кешується на 5 хвилин замість force-dynamic.
 *
 * Було: кожен захід на сайт запускав 5 запитів (три по товарах, groupBy по
 * позиціях замовлень і сезонні промо), хоча вміст для всіх відвідувачів
 * однаковий — персоналізації тут немає.
 *
 * Свіжість не страждає: обмін з 1С у кінці прогону скидає тег
 * CATEGORIES_CACHE_TAG і цей шлях (див. api/sync-ingest/runs/[runId]/complete),
 * тож нові залишки й ціни з'являються одразу після обміну, а не через 5 хвилин.
 * Сезон рахується по місяцю, тож на такому вікні кешу він не «залипає».
 */
export const revalidate = 300;

import JsonLd from "@/components/JsonLd";
import { localBusinessJsonLd, websiteJsonLd } from "@/lib/seo/jsonld";

export const metadata = {
  alternates: { canonical: "/" },
};
import { prisma } from "@/lib/prisma";
import BrandShowcase from "@/components/home/BrandShowcase";
import { getBrandShowcase } from "@/lib/catalog/brand-showcase";
import { getCatalogToc, getSectionTiles } from "@/lib/catalog/sections";
import { formatCount, POSITIONS } from "@/lib/utils";
import CategoryRail from "@/components/home/CategoryRail";
import SectionCards from "@/components/home/SectionCards";
import SectionTiles from "@/components/home/SectionTiles";
import HomeBanners, { type HomeBanner } from "@/components/home/HomeBanners";
import { getCurrentSeason, getSeasonLabel, getSeasonIcon, getSeasonColor, getSeasonWorksLabel, DEFAULT_SEASONAL_KEYWORDS, DEFAULT_SEASONAL_EXCLUDE } from "@/lib/seasonal";

export default async function HomePage() {
  const season = getCurrentSeason();
  const seasonLabel = getSeasonLabel(season);
  const seasonIcon = getSeasonIcon(season);
  const seasonColor = getSeasonColor(season);

  /*
   * Одна хвиля запитів замість двох.
   *
   * Тут були ще дві вибірки товарів — «Хіти продажу» (найбільше замовлень) і
   * «Популярні товари» (десяток ключових слів на кшталт «шуруповерт»). Обидві
   * сітки з головної прибрані: замовлень у базі поки надто мало, щоб «хіти»
   * означали хоч щось, а «популярне» відбиралось за словами в назві, тобто
   * було не популярним, а випадковим. Разом із сітками пішли й запити.
   */
  const [seasonalPromos, showcaseBrands, toc, sectionTiles] = await Promise.all([
    prisma.seasonalPromo.findMany({
      where: {
        isActive: true,
        OR: [
          { season },
          { season: "custom", startDate: { lte: new Date() }, endDate: { gte: new Date() } },
        ],
      },
      orderBy: { sortOrder: "asc" },
    }),
    getBrandShowcase(),
    getCatalogToc(),
    getSectionTiles(),
  ]);

  const seasonalKeywords = seasonalPromos.length > 0
    ? seasonalPromos.flatMap((p) => p.keywords)
    : DEFAULT_SEASONAL_KEYWORDS[season];
  const seasonalProductIds = seasonalPromos.flatMap((p) => p.productIds);
  const seasonalCategoryIds = seasonalPromos.flatMap((p) => p.categoryIds);

  const seasonalConditions: any[] = [];
  if (seasonalKeywords.length > 0) {
    seasonalConditions.push(...seasonalKeywords.map((kw) => ({ name: { contains: kw, mode: "insensitive" as const } })));
  }
  if (seasonalCategoryIds.length > 0) {
    seasonalConditions.push({ categoryId: { in: seasonalCategoryIds } });
  }
  if (seasonalProductIds.length > 0) {
    seasonalConditions.push({ id: { in: seasonalProductIds } });
  }

  // Мінус-слова лише для авторежиму: пошук за підрядком інакше тягне
  // «Тепловентилятор» у літню добірку через слово «вентилятор».
  const seasonalExclude = seasonalPromos.length > 0 ? [] : DEFAULT_SEASONAL_EXCLUDE[season];

  /*
   * Сезонна добірка лишилась однією позицією: з неї банер бере знімок і
   * дізнається, чи є взагалі що показувати. Сітку сезонних товарів на головній
   * замінила вітрина брендів, тож решта вибірки нікуди не йшла.
   */
  const seasonalProducts = seasonalConditions.length > 0
    ? await prisma.product.findMany({
        where: {
          isActive: true,
          stock: { gt: 0 },
          price: { gte: 200 },
          AND: [{ image: { not: null } }, { NOT: { image: "" } }],
          OR: seasonalConditions,
          NOT: seasonalExclude.map((kw) => ({ name: { contains: kw, mode: "insensitive" as const } })),
        },
        select: { image: true },
        orderBy: [{ priority: "desc" }, { stock: "desc" }],
        take: 1,
      })
    : [];

  const seasonalTitle = seasonalPromos.length > 0
    ? seasonalPromos[0].title
    : `${seasonIcon} Сезонні товари — ${seasonLabel}`;

  // «Літо» + «ових» давало «літоових робіт» — прикметник береться готовим.
  const seasonalDesc = seasonalPromos.length > 0 && seasonalPromos[0].description
    ? seasonalPromos[0].description
    : `Актуальні інструменти для ${getSeasonWorksLabel(season)} робіт`;

  const activeSeasonColor = seasonalPromos.length > 0 && seasonalPromos[0].color
    ? seasonalPromos[0].color
    : seasonColor;

  /*
   * Банери першого екрана. Складаються з того, що в магазині справді є, а не
   * з намальованих обіцянок: сезонна добірка й обсяг каталогу. Коли
   * адміністратор заведе акцію в /admin, її банери стануть першими й
   * витіснять автоматичні — саме так, як і має бути.
   *
   * Банера «Хіти продажу» більше немає: він вів якорем до однойменної сітки
   * нижче, а тієї сітки на головній не лишилось.
   */
  const banners: HomeBanner[] = [];

  if (seasonalProducts.length > 0) {
    banners.push({
      id: "seasonal",
      /*
       * Знак пори року зрізаємо разом із «хвостом» emoji.
       *
       * \p{Extended_Pictographic} — це сам символ, але не селектор
       * накреслення U+FE0F і не зʼєднувач U+200D, які йдуть за ним. Тому з
       * «☀️ Сезонні товари» виходило «️ Сезонні товари» — рядок, що
       * починається з невидимого символу: у банері він з'їдав відступ, а в
       * пошуковій видачі й у застосунку лишався сміттям у заголовку.
       */
      title: seasonalTitle.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, ""),
      subtitle: seasonalDesc,
      href: `/catalog?search=${encodeURIComponent(seasonalKeywords[0] ?? "")}`,
      cta: "Дивитись добірку",
      color: activeSeasonColor,
      image: seasonalProducts[0]?.image ?? null,
    });
  }

  banners.push({
    id: "catalog",
    /*
     * Форму слова рахуємо, а не пишемо: «6 277 позицій», але «6 273 позиції».
     * Заодно прибирає toLocaleString — розділювач тисяч у ньому залежить від
     * версії CLDR у середовищі, а це вже одного разу розсипало гідратацію
     * (див. formatPrice у lib/utils).
     */
    title: `${formatCount(toc.total, POSITIONS)} у каталозі`,
    subtitle: "Електро та ручний інструмент, оснастка, кріплення, захист",
    href: "/catalog/zmist",
    cta: "Відкрити каталог",
    color: "#C9D6DF",
    // Знімок беремо з першого банера розділів — він уже порахований і лежить
    // у власному сховищі, тож окремий запит по товар тут зайвий.
    image: sectionTiles.find((t) => t.image)?.image ?? null,
  });

  return (
    <div>
      {/* Магазин у Львові і пошук по сайту — для локальної видачі Google
          і sitelinks searchbox. Дані ті самі, що показує футер. */}
      <JsonLd data={localBusinessJsonLd()} />
      <JsonLd data={websiteJsonLd()} />
      {/*
        Перший екран — вітрина, а не гасло.
        Було: чорний банер на пів екрана з написом «БУДВІК27 — Ваш світ
        інструментів» і одна самотня кнопка. Гасло не повідомляє відвідувачу
        нічого, чого він не знає (він щойно перейшов на цей сайт), а щоб
        побачити, що взагалі продається, треба було натиснути кнопку й піти на
        іншу сторінку. Ті самі пікселі тепер працюють: ліворуч постійно
        розгорнуті розділи, праворуч банери й плитки з фотографіями товарів.
      */}
      <section className="border-b border-[#E5E5E5] bg-[#F7F7F7] py-4 sm:py-5">
        <div className="mx-auto max-w-7xl px-4">
          {/*
            Назва — суцільним чорним із жовтим підкресленням, а не мерехтливим
            градієнтом logo-text-animated. Той градієнт проходить через білий,
            і на світлому тлі першого екрана слово раз на п'ять секунд
            вигорало до невидимого — «БУДВІК27» читалося як «УДВІК27». Клас
            лишається де й був, на чорній шапці, де білий у градієнті на місці.
          */}
          <h1 className="mb-3 text-[15px] font-bold tracking-tight text-[#0A0A0A] sm:mb-4 sm:text-lg">
            <span
              style={{ backgroundImage: "linear-gradient(to top, #FFD600 0, #FFD600 0.34em, transparent 0.34em)" }}
            >
              БУДВІК27
            </span>
            <span className="font-medium text-[#5A5A5A]"> — електро та ручний інструмент від провідних виробників</span>
          </h1>

          {/*
            Ліва колонка з розділами вища за праву, і під банерами лишалась
            порожня пляма мало не в третину екрана. Тепер права колонка тягне
            свої банери на всю висоту рейки: місце заповнене не новим блоком, а
            тим, що на ньому й так стояло, — банери просто стали більшими.
          */}
          <div className="flex items-stretch gap-5">
            <CategoryRail sections={toc.sections} className="hidden w-[264px] shrink-0 lg:block" />

            <div className="flex min-w-0 flex-1 flex-col">
              <HomeBanners banners={banners} />
              {/* Головні розділи — тими самими банерами, що й акції над ними:
                  на вітрині «Ручний інструмент» з 1 518 позиціями важить не
                  менше за сезонну добірку. */}
              <SectionCards
                tiles={sectionTiles.filter((t) => t.featured)}
                className="mt-3 sm:mt-4 lg:flex-1"
              />
            </div>
          </div>

          {/* Решта розділів — смугою на всю ширину, під колонками. */}
          <SectionTiles tiles={sectionTiles.filter((t) => !t.featured)} className="mt-4 sm:mt-6" />
        </div>
      </section>

      {/*
        Бренди — банерами з фотографіями фірмових каталогів.

        На цьому місці була сезонна добірка товарів, але вона повторювала те,
        що вже показують банери першого екрана: ще одна сітка карток між ними
        нічого не додавала. Бренд же — головний вимір цього каталогу, і саме
        його на вітрині не було видно зовсім.

        Нижче стояли ще дві сітки — «Хіти продажу» й «Популярні товари». Перша
        рахувалась за кількістю замовлень, а замовлень у базі поки надто мало,
        щоб слово «хіт» щось означало; друга відбирала товар за словами в
        назві, тобто була не популярною, а випадковою. Разом вони давали три
        екрани прокрутки, на яких покупець не дізнавався нічого нового.
      */}
      <BrandShowcase brands={showcaseBrands} />
    </div>
  );
}
