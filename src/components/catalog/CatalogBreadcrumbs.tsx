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

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Розділ, до якого належать обрані типи.
 *
 * Розділи приходять зі змісту каталогу (getCatalogToc), а не з оголошеного
 * SectionDef.types: у змісті лишаються тільки типи, у яких є що показати,
 * і саме такі посилання роздає вітрина. Якби тут рахувався оголошений
 * список, «увесь розділ» ніколи не збігся б із тим, що в адресі, і ланка
 * розділу поводилась би як ланка типу.
 *
 * Беремо за першим типом: типи з різних розділів одночасно можна лише
 * склеїти руками в адресному рядку, і вигадувати для цього окремий стан
 * дерева немає сенсу.
 */
export function sectionOfTypes(types: string[], sections: SectionOption[]): SectionOption | null {
  if (types.length === 0) return null;
  return sections.find((s) => s.types.includes(types[0])) ?? null;
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

  const section = sectionOfTypes(filters.types, sections);
  if (section) {
    crumbs.push({
      label: section.title,
      href: `/catalog${filtersToQuery({ ...view, types: section.types })}`,
    });
  }

  /*
   * Ланка типу з'являється, лише коли обрано не весь розділ: інакше вона
   * дублювала б попередню ланку й вела б туди ж, звідки людина щойно
   * прийшла — сходинка, що нікуди не веде, гірша за її відсутність.
   */
  const wholeSection =
    section &&
    filters.types.length === section.types.length &&
    section.types.every((t) => filters.types.includes(t));
  if (filters.types.length && !wholeSection) {
    const label = filters.types.length === 1
      ? filters.types[0].charAt(0).toUpperCase() + filters.types[0].slice(1)
      : `${filters.types.length} групи товарів`;
    crumbs.push({
      label,
      href: `/catalog${filtersToQuery({ ...view, types: filters.types })}`,
    });
  }

  if (filters.brands.length === 1 && brandName) {
    crumbs.push({
      label: brandName,
      href: `/catalog${filtersToQuery({ ...view, types: filters.types, brands: filters.brands })}`,
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
