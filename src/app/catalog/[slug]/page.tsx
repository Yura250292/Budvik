// Година, а не хвилина: свіжість цін і залишків забезпечує обмін з 1С —
// його завершення скидає всі сторінки товарів (api/sync-ingest/runs/[runId]/
// complete), а оптова ціна і так рахується на клієнті. Хвилинне вікно
// змушувало функції ре-рендерити 26 тис. карток під кожним обходом бота.
export const revalidate = 3600;

import { cache } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/utils";
import { isRealSku } from "@/lib/catalog/sku-search";
import { showableProductWhere } from "@/lib/catalog/showable";
import { isServiceCategory, productLabel } from "@/lib/catalog/category-display";
import { findSameType } from "@/lib/catalog/related";
import Link from "next/link";
import Image from "next/image";
import NoPhoto from "@/components/ui/NoPhoto";
import AiRecommendations from "@/components/ai/AiRecommendations";
import AiAccessories from "@/components/ai/AiAccessories";
import ProductImageZoom from "@/components/ProductImageZoom";
import ProductDescription from "@/components/ProductDescription";
import ProductAside, { ProductTerms } from "@/components/product/ProductAside";
import { splitDescription } from "@/lib/catalog/description-sections";
import ProductPriceBlock from "./ProductPriceBlock";
import ProductViewTracker from "@/components/webstats/ProductViewTracker";
import JsonLd from "@/components/JsonLd";
import { productJsonLd, breadcrumbJsonLd } from "@/lib/seo/jsonld";
import { isIndexableProduct } from "@/lib/seo/indexable";
import { stripHtml, formatUAH } from "@/lib/seo/site";

// Без generateStaticParams Next 16 взагалі не кладе сторінки динамічного
// сегмента в ISR-кеш: кожен запит — живий рендер (на проді це давало
// no-store і мільйони викликів функцій під ботами). Порожній список — не
// помилка: на збірці не рендеримо нічого (26 тис. карток), а кожен slug
// кешується після першого запиту.
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

// cache() — щоб generateMetadata і сторінка ділили один запит до бази,
// а не ходили за тим самим товаром двічі на кожен рендер.
const getProduct = cache((slug: string) =>
  prisma.product.findUnique({
    where: { slug },
    include: { category: true, brand: { select: { name: true, slug: true } } },
  })
);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return {};

  const price = product.isPromo && product.promoPrice ? product.promoPrice : product.price;
  const plainDescription = stripHtml(product.description);
  const description =
    plainDescription.length > 40
      ? plainDescription.slice(0, 158)
      : `Купити ${product.name} в інтернет-магазині Budvik27. Ціна ${formatUAH(price)} грн, ${
          product.stock > 0 ? "в наявності" : "під замовлення"
        }, доставка по Україні.`;

  return {
    title: `${product.name} — купити, ціна ${formatUAH(price)} грн`,
    description,
    alternates: { canonical: `/catalog/${product.slug}` },
    openGraph: {
      title: product.name,
      description,
      ...(product.image ? { images: [product.image] } : {}),
    },
    // Порожні картки (без ціни, фото чи опису) в індекс не пускаємо —
    // ті самі критерії, що відбирають товари в sitemap.
    robots: isIndexableProduct(product) ? undefined : { index: false, follow: true },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Сесії на сторінці навмисно немає: читання cookies вимикало ISR, і кожен
  // відвідувач чекав живий рендер. Оптова ціна тепер рахується на клієнті
  // (ProductPriceBlock), а сторінка живе в кеші до наступного обміну з 1С.
  const product = await getProduct(slug);

  if (!product) notFound();

  // Схожі товари — той самий тип, але інші розміри й виробники (для круга
  // відрізного це круги інших фірм і діаметрів). Категорія тут не помічник:
  // у звалищі «Імпорт з 1С» лежить 40+ тис. випадкових позицій, тож тип
  // визначаємо за назвою, а на бренд спираємось лише як на запасний варіант.
  // Факти («Характеристики», «Комплектація») виносимо з опису в картки під
  // фото — див. lib/catalog/description-sections. Проза лишається текстом.
  const { specs, kit, rest: descriptionRest } = splitDescription(product.description);

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

  // Крихти для JSON-LD — той самий ланцюжок, що видно в <nav> нижче.
  const crumbs = [
    { name: "Головна", path: "/" },
    { name: "Каталог", path: "/catalog" },
    ...(!isServiceCategory(product.category.name)
      ? [{ name: product.category.name, path: `/catalog?category=${product.category.slug}` }]
      : product.brand
        ? [{ name: product.brand.name, path: `/brand/${product.brand.slug}` }]
        : []),
    { name: product.name },
  ];

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
      <JsonLd data={productJsonLd(product)} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <ProductViewTracker productId={product.id} slug={product.slug} />
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
            <Link href={`/brand/${product.brand.slug}`} className="hover:text-[#FFB800]">
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
        <div className="mb-4 md:float-left md:mb-0 md:mr-8 md:w-[calc(50%_-_1rem)]">
          {product.image ? (
            <ProductImageZoom src={product.image} alt={product.name} />
          ) : (
            <div className="bg-g100 rounded-xl flex items-center justify-center aspect-square">
              <NoPhoto label={productLabel(product.category, product.brand)} size="lg" />
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

          {/* Як заберу і чим заплачу — питання, що виникає рівно біля кнопки. */}
          <div className="mt-4">
            <ProductTerms />
          </div>
        </div>

        {/* Другий плаваючий блок під фото: факти з опису й умови покупки.
            clear-left ставить його рівно під фото, тож опис обтікає спершу
            фото, потім картки — і йде на всю ширину лише там, де ліворуч
            справді нічого немає. У DOM він перед описом навмисно: інакше
            обтікати не буде що, а на телефоні порядок «фото → ціна →
            факти → опис» саме той, що треба. */}
        {(specs.length > 0 || kit.length > 0) && (
          <div className="md:clear-left md:float-left md:mb-6 md:mr-8 md:w-[calc(50%_-_1rem)]">
            <ProductAside specs={specs} kit={kit} />
          </div>
        )}

        {/* Опис — сусід, а не вкладення: перші рядки лягають праворуч від фото,
            решта продовжується під ним на всю ширину сторінки. */}
        <ProductDescription description={descriptionRest} />
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
                    <NoPhoto label={null} size="sm" />
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
