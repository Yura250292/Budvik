/**
 * Банери головних розділів каталогу.
 *
 * Було: п'ятнадцять однакових плиток 96×96 із дрібним підписом у два рядки.
 * На такій сітці всі розділи важать однаково, хоча «Ручний інструмент» — це
 * 1 518 позицій, а «Освітлення» — 17; око не має за що зачепитись і читає
 * підписи один за одним, як список.
 *
 * Тепер шість найбільших розділів виглядають так само, як акційні банери
 * над ними: тон, велика назва, перелік того, що всередині, і фотографія
 * справжнього товару. Решта лишається рядком компактних чипів — вони теж
 * ведуть у каталог, але не сперечаються за увагу.
 *
 * Тон розділу навмисно блідий (SectionDef.tint): насичені банери зверху
 * мусять лишатись найгучнішим, що є на екрані, інакше перший екран
 * перетворюється на вітрину з п'ятнадцятьма «головними» обіцянками.
 */

import Link from "next/link";
import Image from "next/image";
import SectionIcon from "@/components/icons/SectionIcon";
import { formatCount, POSITIONS } from "@/lib/utils";
import type { SectionTile } from "@/lib/catalog/sections";

export default function SectionCards({
  tiles,
  className = "",
}: {
  tiles: SectionTile[];
  className?: string;
}) {
  if (tiles.length === 0) return null;

  return (
    /* auto-rows-fr: ряди ділять висоту порівну. Разом із flex-1 на самій
       смузі це дає банерам дотягнутися до низу рейки розділів — інакше під
       ними лишалась порожня пляма мало не в третину першого екрана. */
    <div className={`grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}>
      {tiles.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-label={`${t.title}, ${formatCount(t.count, POSITIONS)}`}
          className="group relative flex min-h-[96px] cursor-pointer items-stretch overflow-hidden rounded-2xl border border-black/[0.06] transition-shadow duration-200 hover:shadow-[0_10px_24px_-14px_rgba(10,10,10,0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A0A0A] sm:min-h-[136px]"
          style={{ background: `linear-gradient(135deg, ${t.tint} 0%, #FFFFFF 125%)` }}
        >
          <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-between p-3.5 pr-1 sm:p-5 sm:pr-2">
            <div className="min-w-0">
              <span className="mb-2 hidden h-8 w-8 items-center justify-center rounded-lg bg-white/70 text-[#0A0A0A] shadow-[0_1px_2px_rgba(10,10,10,0.06)] transition-colors duration-200 group-hover:bg-[#0A0A0A] group-hover:text-[#FFD600] sm:inline-flex">
                <SectionIcon id={t.id} className="h-[18px] w-[18px]" />
              </span>
              <h3 className="line-clamp-2 max-w-[62%] text-[15px] font-extrabold leading-tight text-[#0A0A0A] sm:max-w-[58%] sm:text-[17px]">
                {t.title}
              </h3>
              {t.summary && (
                /* Перелік типів — не прикраса: він відповідає на «а що там
                   усередині» без переходу. Один рядок, бо в розділі їх
                   десятки, і повний список тут перетворив би банер на зміст. */
                <p className="mt-1 line-clamp-1 max-w-[62%] text-[11px] leading-snug text-[#5A5A5A] sm:max-w-[56%] sm:text-xs">
                  {t.summary}
                </p>
              )}
            </div>

            <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-bold tabular-nums text-[#0A0A0A] transition-colors duration-200 group-hover:bg-[#0A0A0A] group-hover:text-white sm:text-xs">
              {formatCount(t.count, POSITIONS)}
              <svg
                aria-hidden
                className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>

          {t.image ? (
            /* mix-blend-multiply прибирає білу підкладку знімка: фото з 1С
               зняті на білому й без прозорості, тож на кольоровому тлі без
               цього висів би білий прямокутник. Тони розділів світлі — саме
               тому множення тут працює, на темному тлі товар би зник. */
            <Image
              src={t.image}
              alt=""
              aria-hidden
              width={240}
              height={240}
              sizes="(max-width: 640px) 40vw, 240px"
              className="pointer-events-none absolute bottom-0 right-1 h-[78%] w-auto max-w-[40%] object-contain object-bottom mix-blend-multiply transition-transform duration-500 ease-out group-hover:scale-[1.06] sm:right-2 sm:h-[80%] sm:max-w-[42%]"
            />
          ) : (
            <SectionIcon
              id={t.id}
              className="pointer-events-none absolute -bottom-3 -right-2 h-24 w-24 text-[#0A0A0A]/[0.07] sm:h-28 sm:w-28"
            />
          )}
        </Link>
      ))}
    </div>
  );
}
