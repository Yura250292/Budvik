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

import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { localBusinessJsonLd, websiteJsonLd } from "@/lib/seo/jsonld";

export const metadata = {
  alternates: { canonical: "/" },
};
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
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

  const excludeFilter = {
    isActive: true as const,
    NOT: { name: { contains: "верстат" } },
    category: { slug: { notIn: ["1964", "1970", "1465", "1960", "1963", "1972"] } },
  };

  const popularKeywords = ["шуруповерт", "бензопил", "електропил", "ланцюгова пил", "болгарк", "шліфмашин", "генератор", "дриль", "дрель", "перфоратор"];

  // Дві хвилі запитів замість чотирьох послідовних: сезонні промо і дерево
  // брендів ні від чого не залежать, тож їдуть разом із першою хвилею. На
  // кожному revalidate-місі це мінус два послідовні RTT до бази.
  const [featuredProducts, topOrderedItems, seasonalPromos, showcaseBrands, toc, sectionTiles] = await Promise.all([
    prisma.product.findMany({
      where: {
        ...excludeFilter,
        stock: { gt: 0 },
        price: { gte: 500 },
        AND: [{ image: { not: null } }, { NOT: { image: "" } }],
        OR: popularKeywords.map((kw) => ({ name: { contains: kw, mode: "insensitive" as const } })),
      },
      include: { category: true, brand: { select: { name: true } } },
      take: 8,
      orderBy: { price: "asc" },
    }),
    // Best sellers: products most ordered
    prisma.orderItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 8,
    }),
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

  // Друга хвиля: сезонні товари і бестселери залежать від першої, але не
  // одне від одного — тож теж разом.
  const bestSellerIds = topOrderedItems.map((i) => i.productId);
  const [seasonalProducts, bestSellers] = await Promise.all([
    /*
     * Сезонна добірка лишилась однією позицією: з неї банер бере знімок і
     * дізнається, чи є взагалі що показувати. Сітку сезонних товарів на
     * головній замінила вітрина брендів, тож решта вибірки нікуди не йшла.
     */
    seasonalConditions.length > 0
      ? prisma.product.findMany({
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
      : Promise.resolve([]),
    bestSellerIds.length > 0
      ? prisma.product.findMany({
          where: { id: { in: bestSellerIds }, isActive: true, stock: { gt: 0 }, AND: [{ image: { not: null } }, { NOT: { image: "" } }] },
          include: { category: true, brand: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

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

  // Keep order by sales
  const sortedBestSellers = bestSellerIds
    .map((id) => bestSellers.find((p) => p.id === id))
    .filter(Boolean) as typeof bestSellers;

  /*
   * Банери першого екрана. Складаються з того, що в магазині справді є, а не
   * з намальованих обіцянок: сезонна добірка, найкупованіший товар і обсяг
   * каталогу. Коли адміністратор заведе акцію в /admin, її банери стануть
   * першими й витіснять автоматичні — саме так, як і має бути.
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

  if (sortedBestSellers.length > 0) {
    banners.push({
      id: "hits",
      title: "Хіти продажу",
      subtitle: "Те, що беруть найчастіше — перевірено покупцями",
      href: "#hity",
      cta: "До хітів",
      color: "#FFD600",
      image: sortedBestSellers[0]?.image ?? null,
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
    image: featuredProducts[0]?.image ?? null,
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

          <div className="flex gap-5">
            <CategoryRail sections={toc.sections} className="hidden w-[264px] shrink-0 lg:block" />

            <div className="min-w-0 flex-1">
              <HomeBanners banners={banners} />
              {/* Головні розділи — тими самими банерами, що й акції над ними:
                  на вітрині «Ручний інструмент» з 1 518 позиціями важить не
                  менше за сезонну добірку. */}
              <SectionCards tiles={sectionTiles.filter((t) => t.featured)} className="mt-3 sm:mt-4" />
            </div>
          </div>

          {/* Решта розділів — смугою на всю ширину, під колонками. */}
          <SectionTiles tiles={sectionTiles.filter((t) => !t.featured)} className="mt-4 sm:mt-6" />
        </div>
      </section>

      {/*
        Бренди — банерами з фотографіями фірмових каталогів.

        На цьому місці була сезонна добірка товарів, але вона повторювала те,
        що вже показують банери першого екрана й «Хіти продажу» нижче: ще одна
        сітка карток між ними нічого не додавала. Бренд же — головний вимір
        цього каталогу, і саме його на вітрині не було видно зовсім.
      */}
      <BrandShowcase brands={showcaseBrands} />

      {/* Best Sellers */}
      {sortedBestSellers.length > 0 && (
        <section id="hity" className="scroll-mt-20 py-8 sm:py-10 bg-white">
          <div className="max-w-7xl mx-auto px-4">
            <div className="reveal flex items-center gap-3 mb-4 sm:mb-7">
              <div className="w-11 h-11 bg-[#0A0A0A] rounded-xl flex items-center justify-center">
                <svg className="h-5 w-5 text-[#FFD600]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg sm:text-2xl font-bold text-[#0A0A0A]">Хіти продажу</h2>
                <p className="text-xs sm:text-sm text-[#9E9E9E]">Найпопулярніші товари серед наших покупців</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-6">
              {sortedBestSellers.map((product) => (
                <ProductCard key={product.id} {...product} category={product.category} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Featured Products */}
      <section className="py-8 sm:py-10">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="reveal text-xl sm:text-3xl font-bold text-[#0A0A0A] mb-4 sm:mb-8 text-center">Популярні товари</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-6">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} {...product} category={product.category} />
            ))}
          </div>
          <div className="reveal text-center mt-10">
            <Link
              href="/catalog"
              className="inline-block bg-[#FFD600] hover:bg-[#FFC400] text-[#0A0A0A] px-8 py-3.5 rounded-[10px] font-bold transition duration-200 hover:-translate-y-px"
            >
              Дивитись весь каталог
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
