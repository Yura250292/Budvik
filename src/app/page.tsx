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
      <section className="bg-gradient-to-r from-black to-gray-900 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-4">
            <span className="text-yellow-400">BUDVIK</span> — Ваш свiт iнструментiв
          </h1>
          <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
            Електро та ручний iнструмент вiд провiдних виробникiв. Програма лояльностi
            &quot;Болти&quot; — отримуйте кешбек з кожної покупки!
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/catalog"
              className="bg-yellow-400 hover:bg-yellow-300 text-black px-8 py-3 rounded-lg text-lg font-bold transition shadow-lg shadow-yellow-400/20"
            >
              Перейти до каталогу
            </Link>
            <Link
              href="/register"
              className="border border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black px-8 py-3 rounded-lg text-lg font-semibold transition"
            >
              Реєстрація
            </Link>
          </div>
        </div>
      </section>

      {/* Promo Products */}
      {promoProducts.length > 0 && (
        <section className="py-10 bg-gradient-to-b from-yellow-50 to-white">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Акційні товари</h2>
                <p className="text-sm text-gray-500">Спеціальні пропозиції та знижки</p>
              </div>
            </div>
            <PromoCarousel products={promoProducts} />
          </div>
        </section>
      )}

      {/* Loyalty Banner */}
      <section className="bg-yellow-50 py-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="bg-white rounded-xl shadow-lg p-8 flex flex-col md:flex-row items-center gap-6 border border-yellow-100">
            <div className="flex-shrink-0 w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Програма лояльностi &quot;Болти&quot;</h2>
              <p className="text-gray-600">
                Отримуйте <span className="font-bold text-yellow-600">5% кешбек</span> з кожної покупки у вигляді Болтів.
                Використовуйте Болти для оплати до <span className="font-bold text-yellow-600">30%</span> наступного замовлення.
                1 Болт = 1 грн.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Brands */}
      {activeBrands.length > 0 && (
        <section className="py-12">
          <div className="max-w-7xl mx-auto px-4">
            <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Бренди</h2>
            <p className="text-gray-500 text-center mb-8">Iнструменти вiд провiдних виробникiв</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
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
      <section className="py-12 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">Популярні товари</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} {...product} category={product.category} />
            ))}
          </div>
          <div className="text-center mt-8">
            <Link
              href="/catalog"
              className="inline-block bg-yellow-400 hover:bg-yellow-300 text-black px-8 py-3 rounded-lg font-bold transition shadow-lg shadow-yellow-400/20"
            >
              Дивитись весь каталог
            </Link>
          </div>
        </div>
      </section>

      {/* AI Wizard Banner */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="bg-gradient-to-r from-black to-gray-900 rounded-2xl p-8 md:p-12 text-white flex flex-col md:flex-row items-center gap-6 shadow-2xl">
            <div className="flex-1">
              <h2 className="text-2xl md:text-3xl font-bold mb-2">AI Підбір інструментів</h2>
              <p className="text-gray-300 mb-4">
                Не знаєте, який інструмент обрати? Наш AI-помічник підбере
                ідеальний варіант під ваші потреби та бюджет.
              </p>
              <Link
                href="/ai/wizard"
                className="inline-block bg-yellow-400 text-black px-6 py-3 rounded-lg font-bold hover:bg-yellow-300 transition shadow-lg shadow-yellow-400/20"
              >
                Підібрати інструмент
              </Link>
            </div>
            <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0 border border-yellow-400/20">
              <svg className="w-12 h-12 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* AI Recommendations */}
      <section className="py-8 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <AiRecommendations type="personal" title="Рекомендовано для вас" />
        </div>
      </section>
    </div>
  );
}
