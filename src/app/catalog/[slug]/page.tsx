import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/utils";
import AddToCartButton from "./AddToCartButton";
import Link from "next/link";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const product = await prisma.product.findUnique({
    where: { slug },
    include: { category: true },
  });

  if (!product) notFound();

  const relatedProducts = await prisma.product.findMany({
    where: {
      categoryId: product.categoryId,
      id: { not: product.id },
      isActive: true,
    },
    take: 4,
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <nav className="text-sm text-gray-500 mb-6">
        <Link href="/catalog" className="hover:text-orange-600">Каталог</Link>
        {" / "}
        <Link href={`/catalog?category=${product.category.slug}`} className="hover:text-orange-600">
          {product.category.name}
        </Link>
        {" / "}
        <span className="text-gray-900">{product.name}</span>
      </nav>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-gray-100 rounded-xl flex items-center justify-center aspect-square">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-32 w-32 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </div>

        <div>
          <span className="text-sm text-orange-600 font-medium">{product.category.name}</span>
          <h1 className="text-3xl font-bold text-gray-900 mt-1 mb-4">{product.name}</h1>
          <p className="text-gray-600 mb-6 leading-relaxed">{product.description}</p>

          <div className="flex items-baseline gap-3 mb-6">
            <span className="text-4xl font-bold text-orange-600">{formatPrice(product.price)}</span>
          </div>

          <div className="mb-6">
            {product.stock > 0 ? (
              <span className="inline-flex items-center gap-1 text-green-600 text-sm font-medium">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                В наявності ({product.stock} шт.)
              </span>
            ) : (
              <span className="text-red-500 text-sm font-medium">Немає в наявності</span>
            )}
          </div>

          {product.stock > 0 && (
            <AddToCartButton
              productId={product.id}
              name={product.name}
              price={product.price}
              slug={product.slug}
            />
          )}

          <div className="mt-8 bg-orange-50 rounded-lg p-4">
            <p className="text-sm text-orange-700">
              Кешбек за цей товар: <strong>{Math.floor(product.price * 0.05)} Болтів</strong>
            </p>
          </div>
        </div>
      </div>

      {relatedProducts.length > 0 && (
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Схожі товари</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {relatedProducts.map((p) => (
              <Link key={p.id} href={`/catalog/${p.slug}`} className="bg-white border rounded-lg p-4 hover:shadow-md transition">
                <h3 className="font-medium text-sm text-gray-900 mb-2 line-clamp-2">{p.name}</h3>
                <span className="text-orange-600 font-bold">{formatPrice(p.price)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
