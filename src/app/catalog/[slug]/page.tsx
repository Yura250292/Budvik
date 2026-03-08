export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/utils";
import AddToCartButton from "./AddToCartButton";
import Link from "next/link";
import AiRecommendations from "@/components/ai/AiRecommendations";
import AiAccessories from "@/components/ai/AiAccessories";
import ProductImageZoom from "@/components/ProductImageZoom";
import ProductDescription from "@/components/ProductDescription";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const product = await prisma.product.findUnique({
    where: { slug },
    include: { category: true },
  });

  if (!product) notFound();

  const session = await getServerSession(authOptions);
  const isWholesale = session?.user?.role === "WHOLESALE";
  const basePrice = isWholesale && product.wholesalePrice ? product.wholesalePrice : product.price;
  const displayPrice = product.isPromo && product.promoPrice ? product.promoPrice : basePrice;

  const relatedProducts = await prisma.product.findMany({
    where: {
      categoryId: product.categoryId,
      id: { not: product.id },
      isActive: true,
    },
    include: { category: true },
    take: 4,
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <nav className="text-sm text-gray-500 mb-6">
        <Link href="/catalog" className="hover:text-yellow-600">Каталог</Link>
        {" / "}
        <Link href={`/catalog?category=${product.category.slug}`} className="hover:text-yellow-600">
          {product.category.name}
        </Link>
        {" / "}
        <span className="text-gray-900">{product.name}</span>
      </nav>

      <div className="grid md:grid-cols-2 gap-8 relative">
        {product.image ? (
          <div className="relative">
            <ProductImageZoom src={product.image} alt={product.name} />
          </div>
        ) : (
          <div className="bg-gray-100 rounded-xl flex items-center justify-center aspect-square">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-32 w-32 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
        )}

        <div>
          <span className="text-sm text-yellow-600 font-medium">{product.category.name}</span>
          <h1 className="text-3xl font-bold text-gray-900 mt-1 mb-4">{product.name}</h1>
          <ProductDescription description={product.description} />

          <div className="flex items-baseline gap-3 mb-6 flex-wrap">
            <span className={`text-4xl font-bold ${product.isPromo && product.promoPrice ? "text-yellow-600" : "text-gray-900"}`}>
              {formatPrice(displayPrice)}
            </span>
            {product.isPromo && product.promoPrice && product.promoPrice < product.price && (
              <>
                <span className="text-lg text-gray-400 line-through">{formatPrice(product.price)}</span>
                <span className="text-sm bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-medium">
                  {product.promoLabel || `- ${Math.round((1 - product.promoPrice / product.price) * 100)}%`}
                </span>
              </>
            )}
            {isWholesale && product.wholesalePrice && product.wholesalePrice < product.price && !product.isPromo && (
              <>
                <span className="text-lg text-gray-400 line-through">{formatPrice(product.price)}</span>
                <span className="text-sm bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-medium">Оптова ціна</span>
              </>
            )}
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
              price={displayPrice}
              slug={product.slug}
            />
          )}

          <div className="mt-8 bg-yellow-50 rounded-lg p-4 border border-yellow-100">
            <p className="text-sm text-yellow-700">
              Кешбек за цей товар: <strong>{Math.floor(displayPrice * 0.05)} Болтів</strong>
            </p>
          </div>
        </div>
      </div>

      {/* AI Accessories */}
      <AiAccessories productId={product.id} />

      {/* AI Recommendations - Bought Together */}
      <AiRecommendations
        productId={product.id}
        type="bought_together"
        title="Часто купують разом"
      />

      {/* AI Recommendations - Similar */}
      <AiRecommendations
        productId={product.id}
        type="similar"
        title="Схожі товари (AI)"
      />

      {relatedProducts.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-800 to-black flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">З цієї категорії</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {relatedProducts.map((p) => (
              <Link
                key={p.id}
                href={`/catalog/${p.slug}`}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-lg hover:border-yellow-400/50 hover:-translate-y-0.5 transition-all duration-200 group"
              >
                <div className="h-32 bg-gray-50 flex items-center justify-center">
                  {p.image ? (
                    <img src={p.image} alt={p.name} className="h-full w-full object-contain p-2" loading="lazy" />
                  ) : (
                    <svg className="w-10 h-10 text-gray-300 group-hover:text-yellow-300 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  )}
                </div>
                <div className="p-2.5">
                  <h3 className="font-medium text-xs text-gray-900 group-hover:text-yellow-600 transition line-clamp-2 mb-1.5">
                    {p.name}
                  </h3>
                  <span className="text-sm font-bold text-gray-900">{formatPrice(p.price)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
