// Година, а не хвилина: свіжість цін і залишків забезпечує обмін з 1С —
// його завершення скидає всі сторінки товарів (api/sync-ingest/runs/[runId]/
// complete), а оптова ціна і так рахується на клієнті. Хвилинне вікно
// змушувало функції ре-рендерити 26 тис. карток під кожним обходом бота.
export const revalidate = 3600;

import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { isRealSku } from "@/lib/catalog/sku-search";
import { isServiceCategory, productLabel } from "@/lib/catalog/category-display";
import { productRecommendations } from "@/lib/catalog/recommendations";
import Link from "next/link";
import NoPhoto from "@/components/ui/NoPhoto";
import RecoGrid from "@/components/product/RecoGrid";
import AiAccessories from "@/components/ai/AiAccessories";
import ProductImageZoom from "@/components/ProductImageZoom";
import ProductDescription from "@/components/ProductDescription";
import ProductAside, { ProductTerms } from "@/components/product/ProductAside";
import { splitDescription } from "@/lib/catalog/description-sections";
import { sanitizeDescription } from "@/lib/catalog/sanitize-description";
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

/**
 * Блоки рекомендацій окремим компонентом — щоб вони не тримали перший екран.
 *
 * Раніше сторінка чекала на них перед видачею будь-чого; тепер фото, ціна й
 * кнопка йдуть одразу, а рекомендації доїжджають потоком. Це замінює
 * `loading.tsx`, який довелось прибрати: будь-який скелет сегмента вмикав
 * стрімінг ще до рендеру, і `notFound()` уже не міг поставити код 404 —
 * неіснуючий товар віддавав «200 OK» з текстом помилки, тож Google
 * індексував мертві адреси старого сайту.
 */
async function ProductRecommendations({
  product,
}: {
  product: Parameters<typeof productRecommendations>[0];
}) {
  const { boughtTogether, sameType } = await productRecommendations(product);
  return (
    <>
      <RecoGrid title="Часто купують разом" items={boughtTogether} icon="together" />
      <RecoGrid title="Інші розміри та виробники" items={sameType} icon="sizes" />
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

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

  // Факти («Характеристики», «Комплектація») виносимо з опису в картки під
  // фото — див. lib/catalog/description-sections. Проза лишається текстом.
  // Перед цим чистимо розмітку: в описах лежать <img> на сайти постачальників,
  // жодна з тих картинок не завантажується (див. sanitize-description).
  const { specs, kit, rest: descriptionRest } = splitDescription(
    sanitizeDescription(product.description)
  );

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
      <nav className="breadcrumb-scroll text-sm text-[#6B6B6B] mb-4 sm:mb-6">
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
          {/* Темна вохра, а не жовтий #FFB800: жовтий на білому дає контраст
              1,6:1 — напис фізично не читається, хоч і виглядає «фірмово». */}
          {productLabel(product.category, product.brand) && (
            <span className="text-sm font-medium text-[#8A6A00]">
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

      {/*
        Три блоки, кожен відповідає на своє питання, і жоден не повторює інший:
        чим доповнити (Gemini), що беруть разом (історія замовлень або граф
        супутніх типів), які є інші розміри й виробники.

        Блоку «Схожі товари (AI)» тут більше немає. Він не з'явився ні на одній
        із 36 перевірених карток, бо таблиця ProductEmbedding порожня, а
        заповнити її — не вихід: findSimilarProducts вантажить УСІ вектори з
        бази і розбирає їх з JSON на кожен показ картки (21 тис. рядків по
        3072 числа). Та сама відповідь дешевше дається блоком «Інші розміри».
      */}
      <AiAccessories productId={product.id} />
      <Suspense fallback={null}>
        <ProductRecommendations product={product} />
      </Suspense>
    </div>
  );
}
