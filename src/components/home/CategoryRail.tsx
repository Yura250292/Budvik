/**
 * Постійно розгорнутий список розділів — головний вхід у каталог.
 *
 * Був один рядок-кнопка «Каталог за розділами»: щоб побачити, що взагалі
 * продається, треба було спершу здогадатись натиснути. У великих магазинах
 * техніки цей список на головній не ховають зовсім — він тримає ліву колонку
 * першого екрана, бо саме він відповідає на питання, з яким людина прийшла.
 *
 * Рядок читається за три кроки: знак розділу, назва, кількість. Знак —
 * лінійна піктограма з одного набору (див. SectionIcon), а не emoji з
 * SectionDef.icon: п'ятнадцять різнокольорових emoji в колонці шириною 264
 * пікселі виглядають як розсипаний бісер і не тримають лінію інтерфейсу.
 *
 * Серверний компонент: список змінюється лише після обміну з 1С, тримати
 * заради нього клієнтський стан немає причин.
 */

import Link from "next/link";
import SectionIcon from "@/components/icons/SectionIcon";
import type { TocSection } from "@/lib/catalog/sections";

export default function CategoryRail({
  sections,
  className = "",
}: {
  sections: TocSection[];
  className?: string;
}) {
  return (
    <nav aria-label="Розділи каталогу" className={className}>
      <div className="overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_1px_3px_rgba(10,10,10,0.05)]">
        <h2 className="flex items-center gap-2 bg-[#0A0A0A] px-3.5 py-3 text-[13px] font-bold text-white">
          <svg aria-hidden className="h-4 w-4 text-[#FFD600]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Каталог за розділами
        </h2>

        <ul>
          {sections.map((s) => (
            <li key={s.id}>
              <Link
                href={`/catalog?type=${encodeURIComponent(s.types.join(","))}`}
                className="group relative flex min-h-11 cursor-pointer items-center gap-2.5 border-b border-[#F2F2F2] py-1.5 pl-3.5 pr-3 text-[13px] leading-tight text-[#1A1A1A] transition-colors duration-200 last:border-b-0 hover:bg-[#FFFCF0] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A0A0A]"
              >
                {/* Жовта смужка ліворуч замість заливки всього рядка: у
                    колонці з п'ятнадцяти рядків заливка стрибає в очі, а
                    смужка показує, де ти, і не сперечається з назвою. */}
                <span
                  aria-hidden
                  className="absolute left-0 top-0 h-full w-[3px] origin-center scale-y-0 bg-[#FFD600] transition-transform duration-200 group-hover:scale-y-100"
                />
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F5F5F5] text-[#4A4A4A] transition-colors duration-200 group-hover:bg-[#FFD600] group-hover:text-[#0A0A0A]">
                  <SectionIcon id={s.id} className="h-[17px] w-[17px]" />
                </span>
                <span className="flex-1 font-medium group-hover:text-[#0A0A0A]">{s.title}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-[#9E9E9E]">{s.total}</span>
                <svg
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-[#D4D4D4] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[#0A0A0A]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/catalog/zmist"
          className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 border-t border-[#F0F0F0] bg-[#FAFAFA] px-3.5 text-[13px] font-bold text-[#0A0A0A] transition-colors duration-200 hover:bg-[#FFD600] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A0A0A]"
        >
          Усі розділи й типи
          <svg aria-hidden className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </nav>
  );
}
