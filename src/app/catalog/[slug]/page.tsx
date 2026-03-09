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
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
      <nav className="breadcrumb-scroll text-sm text-[#9E9E9E] mb-4 sm:mb-6">
        <Link href="/catalog" className="hover:text-[#FFB800]">Каталог</Link>
        <span className="text-[#DADADA]">{" / "}</span>
        <Link href={`/catalog?category=${product.category.slug}`} className="hover:text-[#FFB800]">
          {product.category.name}
        </Link>
        <span className="text-[#DADADA]">{" / "}</span>
        <span className="text-[#0A0A0A]">{product.name}</span>
      </nav>

      <div className="grid md:grid-cols-2 gap-4 sm:gap-8 relative items-start">
        {/* Left column — sticky image */}
        <div className="md:sticky md:top-4">
          {product.image ? (
            <ProductImageZoom src={product.image} alt={product.name} />
          ) : (
            <div className="bg-g100 rounded-xl flex items-center justify-center aspect-square">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-32 w-32 text-g300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
          )}
        </div>

        {/* Right column — info */}
        <div>
          <span className="text-sm text-primary-dark font-medium">{product.category.name}</span>
          <h1 className="text-xl sm:text-3xl font-bold text-[#0A0A0A] mt-1 mb-3 sm:mb-4 leading-snug">{product.name}</h1>

          {/* Price + availability + cart — right after title */}
          <div className="bg-g50 rounded-xl p-4 sm:p-5 mb-5 border border-g100">
            <div className="flex items-baseline gap-2 sm:gap-3 mb-3 flex-wrap">
              <span className="text-2xl sm:text-4xl font-bold text-[#0A0A0A]">
                {formatPrice(displayPrice)}
              </span>
              {product.isPromo && product.promoPrice && product.promoPrice < product.price && (
                <>
                  <span className="text-lg text-g400 line-through">{formatPrice(product.price)}</span>
                  <span className="text-sm bg-primary/15 text-primary-dark px-2 py-0.5 rounded-full font-medium">
                    {product.promoLabel || `- ${Math.round((1 - product.promoPrice / product.price) * 100)}%`}
                  </span>
                </>
              )}
              {isWholesale && product.wholesalePrice && product.wholesalePrice < product.price && !product.isPromo && (
                <>
                  <span className="text-lg text-g400 line-through">{formatPrice(product.price)}</span>
                  <span className="text-sm bg-primary/15 text-primary-dark px-2 py-0.5 rounded-full font-medium">Оптова ціна</span>
                </>
              )}
            </div>

            <div className="mb-3">
              {product.stock > 0 ? (
                <span className="inline-flex items-center gap-1 text-green-600 text-sm font-medium">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {isWholesale ? `В наявності (${product.stock} шт.)` : "В наявності"}
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

            <div className="mt-3 pt-3 border-t border-g200">
              <p className="text-sm text-primary-dark">
                Кешбек за цей товар: <strong>{Math.floor(displayPrice * 0.05)} Болтів</strong>
              </p>
            </div>
          </div>

          {/* Description below price block */}
          <ProductDescription description={product.description} />
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
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-bk-muted to-bk flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-bk">З цієї категорії</h2>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
            {relatedProducts.map((p) => (
              <Link
                key={p.id}
                href={`/catalog/${p.slug}`}
                className="bg-white border border-g200 rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/50 hover:-translate-y-0.5 transition-all duration-200 group"
              >
                <div className="h-32 bg-g50 flex items-center justify-center">
                  {p.image ? (
                    <img src={p.image} alt={p.name} className="h-full w-full object-contain p-2" loading="lazy" />
                  ) : (
                    <svg className="w-10 h-10 text-g300 group-hover:text-primary-hover transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  )}
                </div>
                <div className="p-2.5">
                  <h3 className="font-medium text-xs text-bk group-hover:text-primary-dark transition line-clamp-2 mb-1.5">
                    {p.name}
                  </h3>
                  <span className="text-sm font-bold text-bk">{formatPrice(p.price)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
