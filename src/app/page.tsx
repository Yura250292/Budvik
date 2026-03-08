export const dynamic = "force-dynamic";

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import AiRecommendations from "@/components/ai/AiRecommendations";
import PromoCarousel from "@/components/PromoCarousel";
import BrandCard from "@/components/BrandCard";
import VikingMascotIcon from "@/components/ai/VikingMascot";
import ToolMatrixRain from "@/components/ToolMatrixRain";
import { BRANDS } from "@/lib/brands";

export default async function HomePage() {
  const excludeFilter = {
    isActive: true as const,
    NOT: { name: { contains: "верстат" } },
    category: { slug: { notIn: ["1964", "1970", "1465", "1960", "1963", "1972"] } },
  };

  const [featuredProducts, promoProducts, allProducts, topOrderedItems] = await Promise.all([
    prisma.product.findMany({
      where: excludeFilter,
      include: { category: true },
      take: 8,
      orderBy: { price: "desc" },
    }),
    prisma.product.findMany({
      where: { ...excludeFilter, isPromo: true },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { name: true },
    }),
    // Best sellers: products most ordered
    prisma.orderItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 8,
    }),
  ]);

  // Fetch best seller product details
  const bestSellerIds = topOrderedItems.map((i) => i.productId);
  const bestSellers = bestSellerIds.length > 0
    ? await prisma.product.findMany({
        where: { id: { in: bestSellerIds }, isActive: true },
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
      <section className="relative bg-gradient-to-b from-[#141414] via-[#1E1E1E] to-[#2A2A2A] text-white py-10 sm:py-14 md:py-20 overflow-hidden">
        <ToolMatrixRain />
        <div className="relative z-10 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-3 sm:mb-4 tracking-tight">
            <span className="text-[#FFD600]">БУДВІК</span> — Ваш свiт iнструментiв
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-[#9E9E9E] mb-5 sm:mb-7 max-w-xl mx-auto leading-relaxed px-2">
            Електро та ручний iнструмент вiд провiдних виробникiв. Програма лояльностi
            &quot;Болти&quot; — кешбек з кожної покупки!
          </p>
          <div className="flex gap-3 sm:gap-4 justify-center flex-wrap px-4">
            <Link
              href="/catalog"
              className="bg-[#FFD600] hover:bg-[#FFC400] active:bg-[#FFB800] text-[#0A0A0A] px-5 sm:px-7 py-2.5 sm:py-3 rounded-[10px] text-sm sm:text-base font-bold transition duration-200"
            >
              До каталогу
            </Link>
            <Link
              href="/register"
              className="border border-[#FFD600]/40 text-[#FFD600] hover:bg-[#FFD600] hover:text-[#0A0A0A] px-5 sm:px-7 py-2.5 sm:py-3 rounded-[10px] text-sm sm:text-base font-semibold transition duration-200"
            >
              Реєстрація
            </Link>
          </div>
        </div>
      </section>

      {/* Best Sellers */}
      {sortedBestSellers.length > 0 && (
        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-11 h-11 bg-[#0A0A0A] rounded-xl flex items-center justify-center">
                <svg className="h-5 w-5 text-[#FFD600]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-[#0A0A0A]">Хіти продажу</h2>
                <p className="text-sm text-[#9E9E9E]">Найпопулярніші товари серед наших покупців</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
              {sortedBestSellers.map((product) => (
                <ProductCard key={product.id} {...product} category={product.category} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Promo Products */}
      {promoProducts.length > 0 && (
        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-11 h-11 bg-[#FFD600]/15 rounded-xl flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#FFB800]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-[#0A0A0A]">Акційні товари</h2>
                <p className="text-sm text-[#9E9E9E]">Спеціальні пропозиції та знижки</p>
              </div>
            </div>
            <PromoCarousel products={promoProducts} />
          </div>
        </section>
      )}

      {/* Loyalty Banner */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="bg-white rounded-xl p-5 sm:p-8 md:p-10 flex flex-col md:flex-row items-center gap-4 sm:gap-6 border border-[#EFEFEF]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.06)' }}>
            <div className="flex-shrink-0 w-16 h-16 bg-[#FFD600]/15 rounded-2xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#FFB800]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-2xl font-bold text-[#0A0A0A] mb-1.5">Програма лояльностi &quot;Болти&quot;</h2>
              <p className="text-[#555] leading-relaxed">
                Отримуйте <span className="font-bold text-[#0A0A0A]">5% кешбек</span> з кожної покупки у вигляді Болтів.
                Використовуйте Болти для оплати до <span className="font-bold text-[#0A0A0A]">30%</span> наступного замовлення.
                1 Болт = 1 грн.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Brands */}
      {activeBrands.length > 0 && (
        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4">
            <h2 className="text-3xl font-bold text-[#0A0A0A] mb-2 text-center">Бренди</h2>
            <p className="text-[#9E9E9E] text-center mb-8">Iнструменти вiд провiдних виробникiв</p>
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

      {/* Featured Products */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-[#0A0A0A] mb-8 text-center">Популярні товари</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
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

      {/* AI Wizard Banner */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="bg-gradient-to-br from-[#0A0A0A] via-[#121212] to-[#1A1A1A] rounded-2xl p-8 md:p-12 text-white flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1">
              <h2 className="text-2xl md:text-3xl font-bold mb-3">AI Підбір інструментів</h2>
              <p className="text-[#9E9E9E] mb-6 leading-relaxed">
                Не знаєте, який інструмент обрати? Наш AI-помічник підбере
                ідеальний варіант під ваші потреби та бюджет.
              </p>
              <Link
                href="/ai/wizard"
                className="inline-block bg-[#FFD600] text-[#0A0A0A] px-6 py-3 rounded-[10px] font-bold hover:bg-[#FFC400] transition duration-200 hover:-translate-y-px"
              >
                Підібрати інструмент
              </Link>
            </div>
            <div className="w-28 h-28 bg-white/5 rounded-2xl flex items-center justify-center flex-shrink-0 border border-[#FFD600]/20">
              <VikingMascotIcon size={96} variant="wink" animated />
            </div>
          </div>
        </div>
      </section>

      {/* AI Recommendations */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4">
          <AiRecommendations type="personal" title="Рекомендовано для вас" />
        </div>
      </section>
    </div>
  );
}
