/**
 * Спільний рендер сторінки бренда — для першої сторінки (/brand/[slug]) і для
 * сегментної пагінації (/brand/[slug]/storinka/[page]).
 *
 * Чому пагінація живе в шляху, а не в `?page=N`: будь-яке звернення до
 * `searchParams` робить сторінку динамічною для ВСІХ запитів, включно з
 * першою — і бренди рендерились наживо на кожен обхід робота, хоч і мали
 * `revalidate = 3600`. Сегмент шляху кешується як окрема сторінка.
 */

import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { fetchCatalogPage } from "@/lib/catalog/query";
import { getBrandTypes } from "@/lib/catalog/brand-tree";
import { SHOWCASE_BY_SLUG } from "@/lib/catalog/brand-showcase";
import { brandAccent, inkOn, shade } from "@/lib/color";
import { formatCount, POSITIONS } from "@/lib/utils";
import LandingListing from "@/components/catalog/LandingListing";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo/jsonld";

export const getBrand = cache((slug: string) =>
  prisma.brand.findFirst({
    where: { slug, isActive: true },
    select: { id: true, name: true, slug: true, color: true, logoUrl: true },
  })
);

const brandFilters = (slug: string) => ({
  brands: [slug],
  types: [],
  showAll: false,
  withImage: false,
  // Як і на сторінці групи: ISR не читає searchParams, тож фільтри живуть на
  // /catalog?brand=…, куди ведуть пілюлі груп нижче.
  attrs: {},
});

export const brandBasePath = (slug: string) => `/brand/${slug}`;

export function brandPageHref(slug: string, page: number): string {
  const base = brandBasePath(slug);
  return page <= 1 ? base : `${base}/storinka/${page}`;
}

export async function buildBrandMetadata(slug: string, page: number): Promise<Metadata> {
  const brand = await getBrand(slug);
  // notFound тут, а не return {}: метадані рендеряться першими, і 404 з
  // тіла сторінки вже не потрапив би в HTTP-статус стрім-відповіді.
  if (!brand) notFound();

  return {
    title:
      page > 1
        ? `Інструменти ${brand.name} — сторінка ${page}`
        : `${brand.name} — купити інструменти ${brand.name}, ціни`,
    description: `Інструменти ${brand.name} в інтернет-магазині Budvik27: актуальні ціни й наявність, доставка по Україні. Повний асортимент ${brand.name} у каталозі.`,
    alternates: { canonical: brandPageHref(brand.slug, page) },
    // Сторінки з другої й далі — не для індексу: вони дублюють одна одну
    // заголовком і описом. follow лишаємо, щоб робот дійшов до карток.
    ...(page > 1 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BrandLanding({ slug, page }: { slug: string; page: number }) {
  const brand = await getBrand(slug);
  if (!brand) notFound();

  const [{ products: rawProducts, total }, types] = await Promise.all([
    fetchCatalogPage(brandFilters(brand.slug), page),
    // shoppable — щоб пілюля не обіцяла більше, ніж покаже клік: видача нижче
    // фільтрує наявність, а числа тут рахувались по всіх активних картках.
    getBrandTypes(brand.slug, { shoppable: true }),
  ]);

  // Сторінка за межами видачі — 404, а не порожня сітка: інакше робот
  // індексує нескінченний хвіст /storinka/999.
  if (page > 1 && rawProducts.length === 0) notFound();

  // Як і в каталозі: картці потрібен лише короткий анонс без розмітки.
  const products = rawProducts.map((p) => ({
    ...p,
    description: p.description.replace(/<[^>]*>/g, "").slice(0, 220),
  }));

  const def = SHOWCASE_BY_SLUG.get(brand.slug);
  const accent = def?.accent ?? brandAccent(brand.name, brand.color);
  const ink = inkOn(accent);

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

      {/*
        Шапка бренда тим самим кольором і тим самим слоганом, що й банер на
        головній: людина натиснула на банер і має потрапити туди, куди
        дивилась, а не на голий список із заголовком.

        Колір — з вітрини, а якщо бренда там немає, виводимо з назви тим самим
        хешем, що й у застосунку: знак бренда мусить бути однаковий скрізь.
      */}
      <div
        className="mb-4 overflow-hidden rounded-2xl p-4 sm:p-6"
        style={{ background: `linear-gradient(135deg, ${accent} 0%, ${shade(accent)} 100%)` }}
      >
        {brand.logoUrl ? (
          // unoptimized: частина логотипів — SVG, а оптимізатор Next без
          // dangerouslyAllowSVG їх не віддає зовсім.
          <span className="mb-3 inline-flex items-center rounded-lg bg-white px-2.5 py-2 shadow-[0_1px_3px_rgba(10,10,10,0.12)]">
            <Image
              src={brand.logoUrl}
              alt={brand.name}
              width={200}
              height={64}
              unoptimized
              className="h-7 w-auto object-contain sm:h-9"
            />
          </span>
        ) : null}

        <h1 className="text-2xl font-bold sm:text-3xl" style={{ color: ink }}>
          Інструменти {brand.name}
        </h1>
        <p className="mt-1 text-sm opacity-85 sm:text-base" style={{ color: ink }}>
          {total > 0
            ? def?.tagline ?? `${formatCount(total, POSITIONS)} з цінами й наявністю`
            : "Товарів не знайдено"}
        </p>

        {total > 0 && (
          <span
            className="mt-3 inline-flex items-center rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold tabular-nums text-[#0A0A0A]"
          >
            {formatCount(total, POSITIONS)}
          </span>
        )}

        {/* Групи всередині бренда — глибше фільтрування вже в каталозі. */}
        {types.length > 0 && (
          <div className="scrollbar-hide -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {types.map((t) => (
              <Link
                key={t.key}
                href={`/catalog?brand=${brand.slug}&type=${encodeURIComponent(t.key)}`}
                /* Білі пілюлі, а не кольорові: вони читаються на будь-якому
                   фірмовому тлі, від чорного TOTAL до помаранчевого APRO. */
                className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-white/90 px-3 text-xs font-medium text-[#0A0A0A] transition-colors duration-200 hover:bg-white"
              >
                {t.label}
                <span className="ml-1.5 text-[#767676]">{t.count}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <LandingListing
        products={products}
        total={total}
        page={page}
        basePath={brandBasePath(brand.slug)}
      />
    </div>
  );
}
