import Link from "next/link";
import type { CatalogFilters } from "@/lib/catalog/query";
import { filtersToQuery } from "@/lib/catalog/query";
import type { BrandNode } from "@/lib/catalog/brand-tree";

/**
 * Увімкнені фільтри рядком під заголовком.
 *
 * Без цього торговий, який показує клієнту порожній екран, не бачить причини:
 * фільтри згорнуті в панель, а «нічого не знайдено» однаково виглядає і при
 * вузькому ціновому діапазоні, і при випадково лишеній галочці бренда.
 */
export default function ActiveFilterChips({
  filters,
  brands,
  unbranded,
  basePath = "/catalog",
}: {
  filters: CatalogFilters;
  brands: BrandNode[];
  unbranded: number;
  /** Куди ведуть чипи: вітрина чи кабінет торгового. */
  basePath?: string;
}) {
  const nameBySlug = new Map(brands.map((b) => [b.slug, b.name]));

  const chips: { label: string; href: string }[] = [];

  for (const slug of filters.brands) {
    const label = slug === "none" ? `Без бренда (${unbranded})` : nameBySlug.get(slug) || slug;
    chips.push({
      label,
      href: `${basePath}${filtersToQuery({ ...filters, brands: filters.brands.filter((b) => b !== slug) })}`,
    });
  }

  for (const t of filters.types) {
    chips.push({
      label: t.charAt(0).toUpperCase() + t.slice(1),
      href: `${basePath}${filtersToQuery({ ...filters, types: filters.types.filter((x) => x !== t) })}`,
    });
  }

  if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
    const from = filters.priceMin !== undefined ? `${filters.priceMin}` : "0";
    const to = filters.priceMax !== undefined ? `${filters.priceMax}` : "∞";
    chips.push({
      label: `Ціна ${from}–${to} грн`,
      href: `${basePath}${filtersToQuery({ ...filters, priceMin: undefined, priceMax: undefined })}`,
    });
  }

  if (filters.inStock) {
    chips.push({
      label: "В наявності",
      href: `${basePath}${filtersToQuery({ ...filters, inStock: false })}`,
    });
  }

  if (filters.withImage) {
    chips.push({
      label: "З фото",
      href: `${basePath}${filtersToQuery({ ...filters, withImage: false })}`,
    });
  }

  if (filters.search) {
    chips.push({
      label: `«${filters.search}»`,
      href: `${basePath}${filtersToQuery({ ...filters, search: undefined })}`,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#FFD600] bg-[#FFD600]/15 px-3 py-1.5 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#FFD600]/30"
        >
          {c.label}
          <svg className="h-3.5 w-3.5 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Link>
      ))}
      {chips.length > 1 && (
        <Link
          href={basePath}
          className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-[#FFB800] transition hover:text-[#FFC400]"
        >
          Скинути все
        </Link>
      )}
    </div>
  );
}
