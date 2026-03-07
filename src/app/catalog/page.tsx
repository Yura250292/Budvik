import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import Link from "next/link";
import AiSmartSearch from "@/components/ai/AiSmartSearch";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ category?: string; search?: string }> }) {
  const params = await searchParams;
  const categorySlug = params.category;
  const search = params.search;

  const where: any = { isActive: true };
  if (categorySlug) where.category = { slug: categorySlug };
  if (search) where.name = { contains: search };

  const [products, categories, activeCategory] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({
      include: { _count: { select: { products: { where: { isActive: true } } } } },
    }),
    categorySlug
      ? prisma.category.findUnique({ where: { slug: categorySlug } })
      : null,
  ]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        {activeCategory ? activeCategory.name : "Каталог інструментів"}
      </h1>
      <p className="text-gray-500 mb-6">Знайдено {products.length} товарів</p>

      {/* AI Smart Search */}
      <div className="mb-8">
        <AiSmartSearch />
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <aside className="w-full md:w-64 flex-shrink-0">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Категорії</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/catalog"
                  className={`block px-3 py-2 rounded text-sm transition ${
                    !categorySlug ? "bg-orange-100 text-orange-700 font-medium" : "hover:bg-gray-100 text-gray-700"
                  }`}
                >
                  Усі товари
                </Link>
              </li>
              {categories.map((cat) => (
                <li key={cat.id}>
                  <Link
                    href={`/catalog?category=${cat.slug}`}
                    className={`block px-3 py-2 rounded text-sm transition flex justify-between ${
                      categorySlug === cat.slug
                        ? "bg-orange-100 text-orange-700 font-medium"
                        : "hover:bg-gray-100 text-gray-700"
                    }`}
                  >
                    <span>{cat.name}</span>
                    <span className="text-gray-400">{cat._count.products}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Products Grid */}
        <div className="flex-1">
          {products.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-lg">Товарів не знайдено</p>
              <Link href="/catalog" className="text-orange-600 hover:underline mt-2 inline-block">
                Переглянути всі товари
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map((product) => (
                <ProductCard key={product.id} {...product} category={product.category} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
