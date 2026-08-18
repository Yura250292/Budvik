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
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import BrandCard from "@/components/BrandCard";
import HeroCta from "@/components/HeroCta";
import { BRANDS } from "@/lib/brands";
import { getBrandTree } from "@/lib/catalog/brand-tree";
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
  const [featuredProducts, topOrderedItems, seasonalPromos, brandTree] = await Promise.all([
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
    getBrandTree(),
  ]);

  let seasonalProducts: any[] = [];
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
  const [seasonalFound, bestSellers] = await Promise.all([
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
          include: { category: true, brand: { select: { name: true } } },
          orderBy: [{ priority: "desc" }, { stock: "desc" }],
          take: 8,
        })
      : Promise.resolve([]),
    bestSellerIds.length > 0
      ? prisma.product.findMany({
          where: { id: { in: bestSellerIds }, isActive: true, stock: { gt: 0 }, AND: [{ image: { not: null } }, { NOT: { image: "" } }] },
          include: { category: true, brand: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  seasonalProducts = seasonalFound;

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

  // Кількість товарів по бренду беремо з brandId, а не з підрядка в назві.
  // Пошук «GROSS» у назві ловив і Grösser, і «gross» усередині чужих слів,
  // а товари, де бренд у назві не згаданий, не рахувались зовсім — до того ж
  // рахунок ішов по вибірці з 500 назв, тож числа під логотипами були
  // випадковими.
  const countBySlug = new Map(
    brandTree.main.concat(brandTree.tail).map((b) => [b.slug.toLowerCase(), b.count])
  );

  const brandCounts: Record<string, number> = {};
  for (const b of BRANDS) {
    const n = countBySlug.get(b.slug.toLowerCase());
    if (n) brandCounts[b.slug] = n;
  }

  // Показуємо лише ті бренди з логотипами, у яких справді є товар
  const activeBrands = BRANDS
    .filter((b) => brandCounts[b.slug] > 0)
    .sort((a, b) => (brandCounts[b.slug] || 0) - (brandCounts[a.slug] || 0));

  return (
    <div>
      {/* Hero */}
      <section className="relative text-white py-7 sm:py-12 md:py-20 overflow-hidden" style={{ background: 'linear-gradient(180deg, #0A0A0A 0%, #111 15%, #1A1A1A 35%, #222 55%, #333 75%, #444 100%)' }}>
        {/* Yellow accent line under header */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-[#FFD600] to-transparent" />
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-3 sm:mb-4 tracking-tight">
            <span className="text-[#FFD600]">БУДВІК27</span> — Ваш світ інструментів
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-[#9E9E9E] mb-5 sm:mb-7 max-w-xl mx-auto leading-relaxed px-2">
            Електро та ручний інструмент від провідних виробників.
            Широкий асортимент і швидка доставка!
          </p>
          <HeroCta />
        </div>
      </section>

      {/*
        Вхід у зміст за розділами. Раніше він жив лише в шапці десктопу і
        всередині каталогу: людина, яка не знає назви товару, з головної
        сторінки не мала жодного способу зорієнтуватись у 49 тис. позицій.
      */}
      <section className="bg-white py-4">
        <div className="max-w-7xl mx-auto px-4">
          <Link
            href="/catalog/zmist"
            className="flex min-h-12 items-center justify-center gap-2 rounded-[10px] border border-[#E0E0E0] bg-white px-4 text-sm font-bold text-[#0A0A0A] transition hover:border-[#FFD600] hover:bg-[#FFD600]/10 active:bg-[#FFD600]/15"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            Каталог за розділами
          </Link>
        </div>
      </section>

      {/* Seasonal Products */}
      {seasonalProducts.length > 0 && (
        <section className="py-8 sm:py-10" style={{ background: `linear-gradient(135deg, ${activeSeasonColor}08, ${activeSeasonColor}15)` }}>
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center gap-3 mb-4 sm:mb-7">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl" style={{ background: `${activeSeasonColor}20` }}>
                {seasonalPromos[0]?.icon || seasonIcon}
              </div>
              <div>
                <h2 className="text-lg sm:text-2xl font-bold text-[#0A0A0A]">{seasonalTitle}</h2>
                <p className="text-sm text-[#9E9E9E]">{seasonalDesc}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-6">
              {seasonalProducts.map((product: any) => (
                <ProductCard key={product.id} {...product} category={product.category} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Best Sellers */}
      {sortedBestSellers.length > 0 && (
        <section className="py-8 sm:py-10 bg-white">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center gap-3 mb-4 sm:mb-7">
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
          <h2 className="text-xl sm:text-3xl font-bold text-[#0A0A0A] mb-4 sm:mb-8 text-center">Популярні товари</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-6">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} {...product} category={product.category} />
            ))}
          </div>
          <div className="text-center mt-10">
            <Link
              href="/catalog"
              className="inline-block bg-[#FFD600] hover:bg-[#FFC400] text-[#0A0A0A] px-8 py-3.5 rounded-[10px] font-bold transition duration-200 hover:-translate-y-px"
            >
              Дивитись весь каталог
            </Link>
          </div>
        </div>
      </section>

      {/* Brands */}
      {activeBrands.length > 0 && (
        <section className="py-8 sm:py-10 bg-white">
          <div className="max-w-7xl mx-auto px-4">
            <h2 className="text-xl sm:text-3xl font-bold text-[#0A0A0A] mb-1 sm:mb-2 text-center">Бренди</h2>
            <p className="text-sm text-[#9E9E9E] text-center mb-5 sm:mb-8">Інструменти від провідних виробників</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
              {activeBrands.map((brand) => (
                <BrandCard
                  key={brand.slug}
                  brand={brand}
                  count={brandCounts[brand.slug] || 0}
                />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
