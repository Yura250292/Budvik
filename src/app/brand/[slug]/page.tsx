export const revalidate = 300;

import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { fetchCatalogPage } from "@/lib/catalog/query";
import { getBrandTypes } from "@/lib/catalog/brand-tree";
import LandingListing from "@/components/catalog/LandingListing";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo/jsonld";

/**
 * Сторінка бренда — комерційний лендінг під запити «інструменти YATO»,
 * «Grösser ціни» тощо.
 *
 * Раніше бренд існував лише як фільтр /catalog?brand=..., і в найцінніших
 * запитів не було цільової сторінки: query-URL не потрапляють у sitemap,
 * а їхні нескінченні комбінації Google вважає дублями. Тут бренд має
 * власний чистий URL, унікальні метатеги і стабільну пагінацію.
 */

type Params = Promise<{ slug: string }>;
type SP = Promise<{ page?: string }>;

const getBrand = cache((slug: string) =>
  prisma.brand.findFirst({
    where: { slug, isActive: true },
    select: { id: true, name: true, slug: true },
  })
);

const brandFilters = (slug: string) => ({
  brands: [slug],
  types: [],
  showAll: false,
  withImage: false,
});

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SP }): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const brand = await getBrand(slug);
  // notFound тут, а не return {}: метадані рендеряться першими, і 404 з
  // тіла сторінки вже не потрапив би в HTTP-статус стрім-відповіді.
  if (!brand) notFound();

  const page = Math.max(1, parseInt(sp.page || "1", 10));
  const path = page > 1 ? `/brand/${brand.slug}?page=${page}` : `/brand/${brand.slug}`;

  return {
    title:
      page > 1
        ? `Інструменти ${brand.name} — сторінка ${page}`
        : `${brand.name} — купити інструменти ${brand.name}, ціни`,
    description: `Інструменти ${brand.name} в інтернет-магазині Budvik27: актуальні ціни й наявність, доставка по Україні. Повний асортимент ${brand.name} у каталозі.`,
    alternates: { canonical: path },
  };
}

export default async function BrandPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const brand = await getBrand(slug);
  if (!brand) notFound();

  const page = Math.max(1, parseInt(sp.page || "1", 10));
  const [{ products: rawProducts, total }, types] = await Promise.all([
    fetchCatalogPage(brandFilters(brand.slug), page),
    getBrandTypes(brand.slug),
  ]);

  // Як і в каталозі: картці потрібен лише короткий анонс без розмітки.
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
          { name: brand.name },
        ])}
      />

      <nav className="breadcrumb-scroll mb-4 flex items-center gap-2 text-sm text-[#9E9E9E] sm:mb-6">
        <Link href="/" className="transition duration-200 hover:text-[#FFB800]">Головна</Link>
        <span className="text-[#DADADA]">/</span>
        <Link href="/catalog" className="transition duration-200 hover:text-[#FFB800]">Каталог</Link>
        <span className="text-[#DADADA]">/</span>
        <span className="font-medium text-[#0A0A0A]">{brand.name}</span>
      </nav>

      <div className="mb-4">
        <h1 className="mb-1 text-2xl font-bold text-[#0A0A0A] sm:text-3xl">
          Інструменти {brand.name}
        </h1>
        <p className="text-sm text-[#9E9E9E] sm:text-base">
          {total > 0
            ? `${total.toLocaleString("uk-UA")} товарів ${brand.name} з цінами й наявністю`
            : "Товарів не знайдено"}
        </p>
      </div>

      {/* Групи всередині бренда — глибше фільтрування вже в каталозі. */}
      {types.length > 0 && (
        <div className="scrollbar-hide -mx-3 mb-4 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {types.map((t) => (
            <Link
              key={t.key}
              href={`/catalog?brand=${brand.slug}&type=${encodeURIComponent(t.key)}`}
              className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-[#E0E0E0] bg-white px-3 text-xs font-medium text-[#555] transition hover:border-[#FFD600] hover:bg-[#FFD600]/10"
            >
              {t.label}
              <span className="ml-1.5 text-[#9E9E9E]">{t.count}</span>
            </Link>
          ))}
        </div>
      )}

      <LandingListing products={products} total={total} page={page} basePath={`/brand/${brand.slug}`} />
    </div>
  );
}
