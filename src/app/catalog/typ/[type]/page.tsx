export const revalidate = 300;

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchCatalogPage } from "@/lib/catalog/query";
import LandingListing from "@/components/catalog/LandingListing";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo/jsonld";

/**
 * Сторінка типу товару — лендінг під запити «валик купити», «перфоратори
 * ціна» тощо. Тип — це той самий токен, що в змісті каталогу (productType):
 * рядки /catalog/zmist тепер ведуть сюди, на чисті індексовані URL, а не в
 * query-фільтр.
 *
 * Тип приходить кирилицею прямо в URL — Google нормально індексує і показує
 * кириличні адреси, а людині /catalog/typ/валик каже більше за трансліт.
 */

type Params = Promise<{ type: string }>;
type SP = Promise<{ page?: string }>;

/** Токен типу: лише літери/цифри/дефіс — все інше 404, а не порожня видача. */
const TYPE_RE = /^[\p{L}\p{N}-]{2,30}$/u;

/** Мінімум товарів, щоб сторінка існувала: тонші за це — сміття в індексі. */
const MIN_PRODUCTS = 5;

const typeFilters = (type: string) => ({
  brands: [],
  types: [type],
  inStock: false,
  withImage: false,
});

function parseType(raw: string): string | null {
  const type = decodeURIComponent(raw).toLowerCase().trim();
  return TYPE_RE.test(type) ? type : null;
}

const typeLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SP }): Promise<Metadata> {
  const [{ type: raw }, sp] = await Promise.all([params, searchParams]);
  const type = parseType(raw);
  if (!type) notFound();

  // 404 вирішується тут, а не лише в тілі сторінки: метадані рендеряться
  // першими, і кинутий пізніше notFound() вже не міняє HTTP-статус
  // відповіді, що стрімиться — Google отримував би 200 для сміттєвих URL.
  const { total } = await fetchCatalogPage(typeFilters(type), 1);
  if (total < MIN_PRODUCTS) notFound();

  const label = typeLabel(type);
  const page = Math.max(1, parseInt(sp.page || "1", 10));
  const base = `/catalog/typ/${encodeURIComponent(type)}`;

  return {
    title: page > 1 ? `${label} — сторінка ${page}` : `${label} — купити, ціни в Україні`,
    description: `${label} в інтернет-магазині Budvik27: ціни, наявність, доставка по Україні. Великий вибір від провідних виробників — обирайте за ціною і брендом.`,
    alternates: { canonical: page > 1 ? `${base}?page=${page}` : base },
  };
}

export default async function TypePage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ type: raw }, sp] = await Promise.all([params, searchParams]);
  const type = parseType(raw);
  if (!type) notFound();

  const page = Math.max(1, parseInt(sp.page || "1", 10));
  const { products: rawProducts, total } = await fetchCatalogPage(typeFilters(type), page);
  if (total < MIN_PRODUCTS) notFound();

  const label = typeLabel(type);
  const products = rawProducts.map((p) => ({
    ...p,
    description: p.description.replace(/<[^>]*>/g, "").slice(0, 220),
  }));

  return (
    <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Головна", path: "/" },
          { name: "Каталог", path: "/catalog" },
          { name: label },
        ])}
      />

      <nav className="breadcrumb-scroll mb-4 flex items-center gap-2 text-sm text-[#9E9E9E] sm:mb-6">
        <Link href="/" className="transition duration-200 hover:text-[#FFB800]">Головна</Link>
        <span className="text-[#DADADA]">/</span>
        <Link href="/catalog" className="transition duration-200 hover:text-[#FFB800]">Каталог</Link>
        <span className="text-[#DADADA]">/</span>
        <span className="font-medium text-[#0A0A0A]">{label}</span>
      </nav>

      <div className="mb-4">
        <h1 className="mb-1 text-2xl font-bold text-[#0A0A0A] sm:text-3xl">{label}</h1>
        <p className="text-sm text-[#9E9E9E] sm:text-base">
          {total.toLocaleString("uk-UA")} товарів з цінами й наявністю
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={`/catalog?type=${encodeURIComponent(type)}`}
          className="inline-flex min-h-9 items-center rounded-full border border-[#E0E0E0] bg-white px-3 text-xs font-medium text-[#555] transition hover:border-[#FFD600] hover:bg-[#FFD600]/10"
        >
          Фільтрувати за брендом і ціною →
        </Link>
        <Link
          href="/catalog/zmist"
          className="inline-flex min-h-9 items-center rounded-full border border-[#E0E0E0] bg-white px-3 text-xs font-medium text-[#555] transition hover:border-[#FFD600] hover:bg-[#FFD600]/10"
        >
          Усі розділи каталогу
        </Link>
      </div>

      <LandingListing products={products} total={total} page={page} basePath={`/catalog/typ/${encodeURIComponent(type)}`} />
    </div>
  );
}
