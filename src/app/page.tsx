export const dynamic = "force-dynamic";

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import AiRecommendations from "@/components/ai/AiRecommendations";
import PromoCarousel from "@/components/PromoCarousel";
import BrandCard from "@/components/BrandCard";
import { BRANDS } from "@/lib/brands";

export default async function HomePage() {
  const [featuredProducts, promoProducts, allProducts] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        NOT: { name: { contains: "верстат" } },
        category: { slug: { notIn: ["1964", "1970", "1465", "1960", "1963", "1972"] } },
      },
      include: { category: true },
      take: 8,
      orderBy: { price: "desc" },
    }),
    prisma.product.findMany({
      where: {
        isActive: true,
        isPromo: true,
        NOT: { name: { contains: "верстат" } },
        category: { slug: { notIn: ["1964", "1970", "1465", "1960", "1963", "1972"] } },
      },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { name: true },
    }),
  ]);

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
      <section className="bg-gradient-to-br from-[#0A0A0A] via-[#121212] to-[#1A1A1A] text-white py-14 sm:py-24 md:py-32">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold mb-4 sm:mb-5 tracking-tight">
            <span className="text-[#FFD600]">BUDVIK</span> — Ваш свiт iнструментiв
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-[#9E9E9E] mb-6 sm:mb-10 max-w-2xl mx-auto leading-relaxed px-2">
            Електро та ручний iнструмент вiд провiдних виробникiв. Програма лояльностi
            &quot;Болти&quot; — отримуйте кешбек з кожної покупки!
          </p>
          <div className="flex gap-3 sm:gap-4 justify-center flex-wrap px-4">
            <Link
              href="/catalog"
              className="bg-[#FFD600] hover:bg-[#FFC400] active:bg-[#FFB800] text-[#0A0A0A] px-6 sm:px-8 py-3 sm:py-3.5 rounded-[10px] text-base sm:text-lg font-bold transition duration-200"
            >
              До каталогу
            </Link>
            <Link
              href="/register"
              className="border border-[#FFD600]/40 text-[#FFD600] hover:bg-[#FFD600] hover:text-[#0A0A0A] px-6 sm:px-8 py-3 sm:py-3.5 rounded-[10px] text-base sm:text-lg font-semibold transition duration-200"
            >
              Реєстрація
            </Link>
          </div>
        </div>
      </section>

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
            <div className="w-24 h-24 bg-white/5 rounded-2xl flex items-center justify-center flex-shrink-0 border border-[#FFD600]/20">
              <svg className="w-12 h-12 text-[#FFD600]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
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
