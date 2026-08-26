/**
 * Постійно розгорнутий список розділів — головний вхід у каталог.
 *
 * Був один рядок-кнопка «Каталог за розділами»: щоб побачити, що взагалі
 * продається, треба було спершу здогадатись натиснути. У великих магазинах
 * техніки цей список на головній не ховають зовсім — він тримає ліву колонку
 * першого екрана, бо саме він відповідає на питання, з яким людина прийшла.
 *
 * Серверний компонент: список змінюється лише після обміну з 1С, тримати
 * заради нього клієнтський стан немає причин.
 */

import Link from "next/link";
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
      <ul className="overflow-hidden rounded-xl border border-[#E5E5E5] bg-white">
        {sections.map((s) => (
          <li key={s.id}>
            <Link
              href={`/catalog?type=${encodeURIComponent(s.types.join(","))}`}
              className="group flex min-h-11 cursor-pointer items-center gap-2.5 border-b border-[#F0F0F0] px-3.5 text-[13px] leading-tight text-[#1A1A1A] transition-colors duration-200 last:border-b-0 hover:bg-[#FFD600]/12"
            >
              <span className="flex-1 font-medium group-hover:text-[#0A0A0A]">{s.title}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-[#9E9E9E]">{s.total}</span>
              <svg
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-[#C9C9C9] transition-colors duration-200 group-hover:text-[#0A0A0A]"
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
        <li>
          <Link
            href="/catalog/zmist"
            className="flex min-h-11 cursor-pointer items-center justify-center gap-2 bg-[#FAFAFA] px-3.5 text-[13px] font-bold text-[#0A0A0A] transition-colors duration-200 hover:bg-[#FFD600]/20"
          >
            Усі розділи
          </Link>
        </li>
      </ul>
    </nav>
  );
}
