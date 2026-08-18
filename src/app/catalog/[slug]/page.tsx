export const revalidate = 60;

import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/utils";
import { isRealSku } from "@/lib/catalog/sku-search";
import { showableProductWhere } from "@/lib/catalog/showable";
import { isServiceCategory, productLabel } from "@/lib/catalog/category-display";
import { findSameType } from "@/lib/catalog/related";
import Link from "next/link";
import Image from "next/image";
import AiRecommendations from "@/components/ai/AiRecommendations";
import AiAccessories from "@/components/ai/AiAccessories";
import ProductImageZoom from "@/components/ProductImageZoom";
import ProductDescription from "@/components/ProductDescription";
import ProductPriceBlock from "./ProductPriceBlock";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Сесії на сторінці навмисно немає: читання cookies вимикало ISR, і кожен
  // відвідувач чекав живий рендер. Оптова ціна тепер рахується на клієнті
  // (ProductPriceBlock), а сторінка кешується на revalidate = 60.
  const product = await prisma.product.findUnique({
    where: { slug },
    include: { category: true, brand: { select: { name: true, slug: true } } },
  });

  if (!product) notFound();

  // Схожі товари — той самий тип, але інші розміри й виробники (для круга
  // відрізного це круги інших фірм і діаметрів). Категорія тут не помічник:
  // у звалищі «Імпорт з 1С» лежить 40+ тис. випадкових позицій, тож тип
  // визначаємо за назвою, а на бренд спираємось лише як на запасний варіант.
  const sameType = await findSameType(product, 4);
  const relatedProducts =
    sameType.length > 0
      ? sameType
      : await prisma.product.findMany({
          where: {
            ...(isServiceCategory(product.category.name) && product.brandId
              ? { brandId: product.brandId }
              : { categoryId: product.categoryId }),
            id: { not: product.id },
            ...showableProductWhere(),
          },
          // brandId — щоб обидві гілки давали однаковий тип, інакше union
          // двох різних масивів ламає вивід типу в .map() нижче
          select: { id: true, name: true, slug: true, price: true, image: true, brandId: true },
          take: 4,
        });

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
      <nav className="breadcrumb-scroll text-sm text-[#9E9E9E] mb-4 sm:mb-6">
        <Link href="/catalog" className="hover:text-[#FFB800]">Каталог</Link>
        <span className="text-[#DADADA]">{" / "}</span>
        {/* Службова категорія 1С покупцю нічого не каже — там ведемо по бренду,
            бо саме він працює навігацією каталогу. */}
        {!isServiceCategory(product.category.name) ? (
          <>
            <Link href={`/catalog?category=${product.category.slug}`} className="hover:text-[#FFB800]">
              {product.category.name}
            </Link>
            <span className="text-[#DADADA]">{" / "}</span>
          </>
        ) : product.brand ? (
          <>
            <Link href={`/catalog?brand=${product.brand.slug}`} className="hover:text-[#FFB800]">
              {product.brand.name}
            </Link>
            <span className="text-[#DADADA]">{" / "}</span>
          </>
        ) : null}
        <span className="text-[#0A0A0A]">{product.name}</span>
      </nav>

      {/* Фото пливе ліворуч, а не стоїть колонкою сітки: у сітці довгий опис
          тягнувся вузьким стовпчиком і лишав під фото пів екрана порожнечі.
          З float опис обтікає фото, а нижче його межі йде на всю ширину. */}
      <div className="relative flow-root">
        {/* Left column — image */}
        <div className="mb-4 md:float-left md:mb-6 md:mr-8 md:w-[calc(50%_-_1rem)]">
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

        {/* Right column — info. flow-root робить свій контекст форматування,
            щоб блок ціни став поруч із фото, а не заповз під нього фоном. */}
        <div className="md:flow-root">
          {productLabel(product.category, product.brand) && (
            <span className="text-sm text-primary-dark font-medium">
              {productLabel(product.category, product.brand)}
            </span>
          )}
          <h1 className="text-xl sm:text-3xl font-bold text-[#0A0A0A] mt-1 mb-2 leading-snug">{product.name}</h1>

          {/* Артикул: за ним клієнт замовляє по телефону і шукає повторно.
              Службові «1C-*» ховаємо — це наша заглушка, а не код товару. */}
          {isRealSku(product.sku) && (
            <p className="mb-3 text-sm text-g400 sm:mb-4">
              Артикул: <span className="font-medium tabular-nums text-g600">{product.sku}</span>
            </p>
          )}

          {/* Price + availability + cart — right after title */}
          <ProductPriceBlock
            id={product.id}
            name={product.name}
            slug={product.slug}
            price={product.price}
            isPromo={product.isPromo}
            promoPrice={product.promoPrice}
            promoLabel={product.promoLabel}
            stock={product.stock}
            image={product.image}
            packQty={product.packQty}
          />

          {/* Кнопка «Симулювати продуктивність» прихована разом із розділом симуляції. */}
        </div>

        {/* Опис — сусід, а не вкладення: перші рядки лягають праворуч від фото,
            решта продовжується під ним на всю ширину сторінки. */}
        <ProductDescription description={product.description} />
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
            <h2 className="text-xl font-bold text-bk">Інші розміри та виробники</h2>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
            {relatedProducts.map((p) => (
              <Link
                key={p.id}
                href={`/catalog/${p.slug}`}
                className="bg-white border border-g200 rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/50 hover:-translate-y-0.5 active:scale-[0.98] transition-[box-shadow,border-color,transform] duration-150 group"
              >
                <div className="relative h-32 bg-g50 flex items-center justify-center">
                  {p.image ? (
                    <Image src={p.image} alt={p.name} fill className="object-contain p-2" sizes="(max-width: 640px) 33vw, 25vw" />
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
