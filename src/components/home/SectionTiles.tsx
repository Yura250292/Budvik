/**
 * Плитки розділів із фотографією справжнього товару.
 *
 * Замінюють ряд emoji: 🎨 однаково позначає фарбу, дизайн і свято, тож як
 * навігація він не працює — око все одно читає підпис. Фото болгарки під
 * підписом «Електроінструмент» дає відповідь швидше, ніж встигаєш прочитати.
 */

import Link from "next/link";
import Image from "next/image";
import type { SectionTile } from "@/lib/catalog/sections";

export default function SectionTiles({
  tiles,
  className = "",
}: {
  tiles: SectionTile[];
  className?: string;
}) {
  if (tiles.length === 0) return null;

  return (
    <div className={className}>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-[#E5E5E5] bg-white transition-colors duration-200 hover:border-[#FFD600]"
          >
            <div className="flex h-16 items-center justify-center bg-[#FAFAFA] sm:h-20">
              {t.image ? (
                <Image
                  src={t.image}
                  alt=""
                  aria-hidden
                  width={96}
                  height={96}
                  sizes="96px"
                  className="h-full w-full object-contain p-1.5 transition-transform duration-300 ease-out group-hover:scale-105"
                />
              ) : (
                <svg aria-hidden className="h-7 w-7 text-[#C9C9C9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h10" />
                </svg>
              )}
            </div>
            <div className="flex flex-1 flex-col justify-between gap-0.5 px-2 py-2">
              {/* Два рядки з фіксованою висотою: назви розділів різної довжини,
                  і без стелі плитки в сітці виходять різновисокими. */}
              <span className="line-clamp-2 min-h-[26px] text-[11px] font-semibold leading-tight text-[#1A1A1A] sm:min-h-[30px] sm:text-xs">
                {t.title}
              </span>
              <span className="text-[10px] tabular-nums text-[#9E9E9E]">{t.count} позицій</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
