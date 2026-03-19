export const dynamic = "force-dynamic";

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import BrandCard from "@/components/BrandCard";
import HeroCta from "@/components/HeroCta";
import { BRANDS } from "@/lib/brands";
import { getCurrentSeason, getSeasonLabel, getSeasonIcon, getSeasonColor, DEFAULT_SEASONAL_KEYWORDS } from "@/lib/seasonal";

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

  const [featuredProducts, allProducts, topOrderedItems] = await Promise.all([
    prisma.product.findMany({
      where: {
        ...excludeFilter,
        stock: { gt: 0 },
        price: { gte: 500 },
        AND: [{ image: { not: null } }, { NOT: { image: "" } }],
        OR: popularKeywords.map((kw) => ({ name: { contains: kw, mode: "insensitive" as const } })),
      },
      include: { category: true },
      take: 8,
      orderBy: { price: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { name: true },
      take: 500,
    }),
    // Best sellers: products most ordered
    prisma.orderItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 8,
    }),
  ]);

  // Fetch seasonal products
  const seasonalPromos = await prisma.seasonalPromo.findMany({
    where: {
      isActive: true,
      OR: [
        { season },
        { season: "custom", startDate: { lte: new Date() }, endDate: { gte: new Date() } },
      ],
    },
    orderBy: { sortOrder: "asc" },
  });

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

  if (seasonalConditions.length > 0) {
    seasonalProducts = await prisma.product.findMany({
      where: {
        isActive: true,
        stock: { gt: 0 },
        price: { gte: 200 },
        AND: [{ image: { not: null } }, { NOT: { image: "" } }],
        OR: seasonalConditions,
      },
      include: { category: true },
      orderBy: [{ priority: "desc" }, { stock: "desc" }],
      take: 8,
    });
  }

  const seasonalTitle = seasonalPromos.length > 0
    ? seasonalPromos[0].title
    : `${seasonIcon} Сезонні товари — ${seasonLabel}`;

  const seasonalDesc = seasonalPromos.length > 0 && seasonalPromos[0].description
    ? seasonalPromos[0].description
    : `Актуальні інструменти для ${seasonLabel.toLowerCase()}ових робіт`;

  const activeSeasonColor = seasonalPromos.length > 0 && seasonalPromos[0].color
    ? seasonalPromos[0].color
    : seasonColor;

  // Fetch best seller product details
  const bestSellerIds = topOrderedItems.map((i) => i.productId);
  const bestSellers = bestSellerIds.length > 0
    ? await prisma.product.findMany({
        where: { id: { in: bestSellerIds }, isActive: true, stock: { gt: 0 }, AND: [{ image: { not: null } }, { NOT: { image: "" } }] },
        include: { category: true },
      })
    : [];
  // Keep order by sales
  const sortedBestSellers = bestSellerIds
    .map((id) => bestSellers.find((p) => p.id === id))
    .filter(Boolean) as typeof bestSellers;

  // Count products per brand
  const brandCounts: Record<string, number> = {};
  for (const p of allProducts) {
    const upper = p.name.toUpperCase();
    for (const b of BRANDS) {
      if (upper.includes(b.slug.toUpperCase())) {
        brandCounts[b.slug] = (brandCounts[b.slug] || 0) + 1;
        break;
      }
    }
  }

  // Only show brands that have products, sorted by count
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
            <span className="text-[#FFD600]">БУДВІК</span> — Ваш свiт iнструментiв
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-[#9E9E9E] mb-5 sm:mb-7 max-w-xl mx-auto leading-relaxed px-2">
            Електро та ручний iнструмент вiд провiдних виробникiв. Програма лояльностi
            &quot;Болти&quot; — кешбек з кожної покупки!
          </p>
          <HeroCta />
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
            <p className="text-sm text-[#9E9E9E] text-center mb-5 sm:mb-8">Iнструменти вiд провiдних виробникiв</p>
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
