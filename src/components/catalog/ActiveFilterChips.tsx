import Link from "next/link";
import type { CatalogFilters } from "@/lib/catalog/query";
import { filtersToQuery } from "@/lib/catalog/query";
import type { BrandNode } from "@/lib/catalog/brand-tree";
import type { SectionOption } from "@/components/catalog/CatalogFilters";

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
  sections = [],
  basePath = "/catalog",
  defaultShowAll = false,
}: {
  filters: CatalogFilters;
  brands: BrandNode[];
  unbranded: number;
  /** Розділи каталогу — щоб цілий розділ показати одним чипом, а не дюжиною. */
  sections?: SectionOption[];
  /** Куди ведуть чипи: вітрина чи кабінет торгового. */
  basePath?: string;
  /**
   * Яким «показувати відсутні» є для секції за замовчуванням.
   *
   * У кабінеті торгового це увімкнено завжди, тож чип «З відсутніми» висів
   * там постійно і не знімався: посилання вело на ту саму адресу. Показуємо
   * чип лише тоді, коли значення відрізняється від дефолту секції.
   */
  defaultShowAll?: boolean;
}) {
  const nameBySlug = new Map(brands.map((b) => [b.slug, b.name]));
  const query = (f: Partial<CatalogFilters>) => filtersToQuery(f, undefined, { defaultShowAll });

  const chips: { label: string; href: string }[] = [];

  for (const slug of filters.brands) {
    const label = slug === "none" ? `Без бренда (${unbranded})` : nameBySlug.get(slug) || slug;
    chips.push({
      label,
      href: `${basePath}${query({ ...filters, brands: filters.brands.filter((b) => b !== slug) })}`,
    });
  }

  /*
   * Цілий розділ — це дюжина типів в адресі, але для людини один вибір.
   *
   * Перехід із банера «Різальний інструмент» малював дванадцять чипів
   * (Свердло ×, Круг ×, Диск ×…) — рядок, у якому не видно ні що обрано, ні
   * як це скинути одним рухом. Показуємо назву розділу, а хрестик знімає
   * його цілком.
   */
  const wholeSection = sections.find(
    (sec) =>
      sec.types.length === filters.types.length &&
      sec.types.every((t) => filters.types.includes(t))
  );

  if (wholeSection) {
    chips.push({
      label: wholeSection.title,
      href: `${basePath}${query({ ...filters, types: [] })}`,
    });
  } else {
    for (const t of filters.types) {
      chips.push({
        label: t.charAt(0).toUpperCase() + t.slice(1),
        href: `${basePath}${query({ ...filters, types: filters.types.filter((x) => x !== t) })}`,
      });
    }
  }

  if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
    const from = filters.priceMin !== undefined ? `${filters.priceMin}` : "0";
    const to = filters.priceMax !== undefined ? `${filters.priceMax}` : "∞";
    chips.push({
      label: `Ціна ${from}–${to} грн`,
      href: `${basePath}${query({ ...filters, priceMin: undefined, priceMax: undefined })}`,
    });
  }

  if (filters.showAll !== defaultShowAll) {
    chips.push({
      label: filters.showAll ? "З відсутніми" : "Лише в наявності",
      href: `${basePath}${query({ ...filters, showAll: defaultShowAll })}`,
    });
  }

  if (filters.withImage) {
    chips.push({
      label: "З фото",
      href: `${basePath}${query({ ...filters, withImage: false })}`,
    });
  }

  if (filters.search) {
    chips.push({
      label: `«${filters.search}»`,
      href: `${basePath}${query({ ...filters, search: undefined })}`,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          rel="nofollow"
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
