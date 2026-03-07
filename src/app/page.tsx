import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";

export default async function HomePage() {
  const categories = await prisma.category.findMany({
    include: { _count: { select: { products: true } } },
  });

  const featuredProducts = await prisma.product.findMany({
    where: { isActive: true },
    include: { category: true },
    take: 8,
    orderBy: { price: "desc" },
  });

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-r from-gray-900 to-gray-800 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-4">
            <span className="text-orange-500">BUDVIK</span> — Ваш світ інструментів
          </h1>
          <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
            Електро та ручний інструмент від провідних виробників. Програма лояльності
            &quot;Болти&quot; — отримуйте кешбек з кожної покупки!
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/catalog"
              className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-3 rounded-lg text-lg font-semibold transition"
            >
              Перейти до каталогу
            </Link>
            <Link
              href="/register"
              className="border border-orange-600 text-orange-400 hover:bg-orange-600 hover:text-white px-8 py-3 rounded-lg text-lg font-semibold transition"
            >
              Реєстрація
            </Link>
          </div>
        </div>
      </section>

      {/* Loyalty Banner */}
      <section className="bg-orange-50 py-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="bg-white rounded-xl shadow-md p-8 flex flex-col md:flex-row items-center gap-6">
            <div className="flex-shrink-0 w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Програма лояльності &quot;Болти&quot;</h2>
              <p className="text-gray-600">
                Отримуйте <span className="font-bold text-orange-600">5% кешбек</span> з кожної покупки у вигляді Болтів.
                Використовуйте Болти для оплати до <span className="font-bold text-orange-600">30%</span> наступного замовлення.
                1 Болт = 1 грн.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">Категорії</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/catalog?category=${cat.slug}`}
                className="bg-white border border-gray-200 rounded-lg p-4 text-center hover:shadow-md hover:border-orange-300 transition"
              >
                <div className="w-12 h-12 mx-auto mb-2 bg-orange-100 rounded-full flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                </div>
                <h3 className="font-medium text-sm text-gray-900">{cat.name}</h3>
                <p className="text-xs text-gray-500 mt-1">{cat._count.products} товарів</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

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
              className="inline-block bg-orange-600 hover:bg-orange-500 text-white px-8 py-3 rounded-lg font-semibold transition"
            >
              Дивитись весь каталог
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
