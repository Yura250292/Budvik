/**
 * Смуга решти розділів — тих, що не пішли банерами.
 *
 * Дрібні розділи не варті банера: «Освітлення та електрика» — 17 позицій, і
 * велика плитка обіцяла б за ними більше, ніж там є. Але й ховати їх нема за
 * що: людина, якій потрібні рукавиці, мусить побачити «Засоби захисту» з
 * головної, а не шукати їх у змісті.
 *
 * Тому — рядок компактних плиток на всю ширину під першим екраном: фото
 * товару, назва, кількість. Той самий тон розділу, що й на банерах, тримає
 * усе разом.
 */

import Link from "next/link";
import Image from "next/image";
import SectionIcon from "@/components/icons/SectionIcon";
import { formatCount, POSITIONS } from "@/lib/utils";
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
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-[#6B6B6B]">Ще розділи</h2>
        <Link
          href="/catalog/zmist"
          className="cursor-pointer text-[12px] font-semibold text-[#0A0A0A] underline-offset-4 transition-colors duration-200 hover:text-[#8A7300] hover:underline"
        >
          Весь зміст каталогу
        </Link>
      </div>

      {/* auto-fit, а не фіксовані колонки: розділів у смузі стільки, скільки
          лишилось після банерів, і воно змінюється разом із каталогом —
          «Сантехніка» зникає зі змісту, щойно в ній не лишається типу від
          восьми позицій. Жорсткі дев'ять колонок лишали б у ряду дірку. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3 lg:[grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))]">
        {tiles.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-label={`${t.title}, ${formatCount(t.count, POSITIONS)}`}
            className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-[#E5E5E5] bg-white transition-colors duration-200 hover:border-[#FFD600] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A0A0A]"
          >
            <div
              className="flex h-[58px] items-center justify-center sm:h-16"
              style={{ backgroundColor: t.tint }}
            >
              {t.image ? (
                <Image
                  src={t.image}
                  alt=""
                  aria-hidden
                  width={128}
                  height={128}
                  sizes="128px"
                  className="h-full w-full object-contain p-1.5 mix-blend-multiply transition-transform duration-300 ease-out group-hover:scale-105"
                />
              ) : (
                <SectionIcon id={t.id} className="h-6 w-6 text-[#0A0A0A]/45" />
              )}
            </div>
            <div className="flex flex-1 flex-col justify-between gap-0.5 px-2 py-2">
              {/* Два рядки з фіксованою висотою: назви розділів різної довжини,
                  і без стелі плитки в сітці виходять різновисокими. */}
              <span className="line-clamp-2 min-h-[26px] text-[11px] font-semibold leading-tight text-[#1A1A1A] sm:min-h-[28px]">
                {t.title}
              </span>
              <span className="text-[10px] tabular-nums text-[#8A8A8A]">
                {formatCount(t.count, POSITIONS)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
