/**
 * Шлях по каталогу з поверненням на будь-який рівень.
 *
 * Було: «Головна / Каталог / Бренд» — три ланки, з яких дві завжди однакові.
 * Людина, яка прийшла з банера «Різальний інструмент», далі звузила до кругів
 * і додала бренд, не мала чим піднятись на крок назад: єдиною кнопкою було
 * «Скинути фільтри», тобто повернутись на самий початок.
 *
 * Тепер шлях повторює те, як каталог справді влаштований — розділ, тип,
 * бренд — і кожна ланка веде на свій рівень, скидаючи лише те, що глибше.
 * Останню ланку не робимо посиланням: вона і є поточна сторінка.
 */

import Link from "next/link";
import { filtersToQuery, type CatalogFilters } from "@/lib/catalog/query";
import type { SectionOption } from "@/components/catalog/CatalogFilters";
import { TYPE_LABELS } from "@/lib/catalog/classify";

/** Людська назва групи: «Свердла» замість ключа «свердло». */
const typeLabel = (key: string) => TYPE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Розділ, у якому людина зараз перебуває.
 *
 * Раніше він вгадувався за першим обраним типом — доводилось тримати в
 * SectionOption повний перелік груп і звіряти його з адресою. Тепер розділ
 * приходить власним ?section=, і крихта завжди знає, звідки прийшли: навіть
 * коли всередині розділу не обрано жодної групи.
 */
export function sectionOfFilters(
  filters: CatalogFilters,
  sections: SectionOption[]
): SectionOption | null {
  if (!filters.section) return null;
  return sections.find((s) => s.id === filters.section) ?? null;
}

export function buildCrumbs(
  filters: CatalogFilters,
  sections: SectionOption[],
  brandName?: string | null
): Crumb[] {
  const crumbs: Crumb[] = [
    { label: "Головна", href: "/" },
    { label: "Каталог", href: "/catalog" },
  ];

  // Показ («лише з фото», «показати відсутні») — не рівень дерева, а те, як
  // людина дивиться на будь-який із них: переносимо на всі ланки.
  const view = { showAll: filters.showAll, withImage: filters.withImage };

  const section = sectionOfFilters(filters, sections);
  if (section) {
    crumbs.push({
      label: section.title,
      href: `/catalog${filtersToQuery({ ...view, section: section.id })}`,
    });
  }

  /*
   * Ланка групи з'являється, лише коли всередині розділу щось обрано:
   * інакше вона дублювала б попередню й вела б туди ж, звідки людина щойно
   * прийшла — сходинка, що нікуди не веде, гірша за її відсутність.
   */
  if (filters.types.length) {
    const label = filters.types.length === 1
      ? typeLabel(filters.types[0])
      : `${filters.types.length} групи товарів`;
    crumbs.push({
      label,
      href: `/catalog${filtersToQuery({ ...view, section: filters.section, types: filters.types })}`,
    });
  }

  if (filters.brands.length === 1 && brandName) {
    crumbs.push({
      label: brandName,
      href: `/catalog${filtersToQuery({ ...view, section: filters.section, types: filters.types, brands: filters.brands })}`,
    });
  }

  if (filters.search) crumbs.push({ label: `Пошук: «${filters.search}»` });

  // Остання ланка — поточне місце, посилання на себе їй ні до чого.
  const last = crumbs[crumbs.length - 1];
  if (last) delete last.href;

  return crumbs;
}

export default function CatalogBreadcrumbs({
  filters,
  sections,
  brandName,
}: {
  filters: CatalogFilters;
  sections: SectionOption[];
  brandName?: string | null;
}) {
  const crumbs = buildCrumbs(filters, sections, brandName);

  return (
    <nav aria-label="Шлях по каталогу" className="breadcrumb-scroll mb-4 flex items-center gap-1.5 text-sm sm:mb-6">
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex flex-shrink-0 items-center gap-1.5">
          {i > 0 && (
            <svg aria-hidden className="h-3 w-3 text-[#D4D4D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          )}
          {c.href ? (
            <Link
              href={c.href}
              // Фільтровані адреси в індекс не йдуть (див. generateMetadata),
              // тож і ваги посиланням на них передавати нема за що.
              rel={c.href.includes("?") ? "nofollow" : undefined}
              className="whitespace-nowrap rounded px-1 py-0.5 text-[#6B6B6B] transition-colors duration-200 hover:bg-[#FFD600]/20 hover:text-[#0A0A0A] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0A0A0A]"
            >
              {c.label}
            </Link>
          ) : (
            <span aria-current="page" className="whitespace-nowrap px-1 py-0.5 font-semibold text-[#0A0A0A]">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
