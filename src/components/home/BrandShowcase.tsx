/**
 * Банери брендів на головній.
 *
 * Було: сітка з шістнадцяти плиток 96×96, де замість логотипів здебільшого
 * стояли SVG із написом Arial, а половина плиток вела на неіснуючі сторінки —
 * слаги в тому списку були свої, не ті, що в базі. Бренд у такому вигляді не
 * продає нічого: він не показує ні товару, ні того, чим бренд відрізняється.
 *
 * Тепер вісім банерів із фотографіями справжніх товарів із фірмових каталогів.
 * Знімки лежать у білих плитках «віялом», а не врізані в тло: фото з каталогів
 * зняті на білому й без прозорості, і на кольоровому банері з них стирчав би
 * білий прямокутник. Прийом mix-blend-multiply, яким це лікують банери вище,
 * тут не годиться — він працює лише на світлому тлі, а більшість фірмових
 * кольорів темні. Плитка ж читається як картка товару й виглядає однаково
 * доречно на будь-якому тлі.
 *
 * Компонент серверний: у бандл не додається ні байта: увесь рух — CSS
 * (.brand-banner у globals.css), поява — .reveal на таймлайні перегляду.
 */

import Link from "next/link";
import Image from "next/image";
import { formatCount, POSITIONS } from "@/lib/utils";
import { inkOn, INK_LIGHT } from "@/lib/color";
import type { ShowcaseBrand } from "@/lib/catalog/brand-showcase";

export default function BrandShowcase({
  brands,
  className = "",
}: {
  brands: ShowcaseBrand[];
  className?: string;
}) {
  if (brands.length === 0) return null;

  return (
    <section className={`bg-white py-8 sm:py-12 ${className}`}>
      <div className="mx-auto max-w-7xl px-4">
        <div className="reveal mb-4 flex items-end justify-between gap-4 sm:mb-6">
          <div>
            <h2 className="text-xl font-bold text-[#0A0A0A] sm:text-3xl">Бренди</h2>
            <p className="mt-0.5 text-sm text-[#9E9E9E]">
              Фірмові каталоги — з цінами й наявністю на складі
            </p>
          </div>
          <Link
            href="/catalog/zmist"
            className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-[#0A0A0A] underline-offset-4 transition-colors duration-200 hover:text-[#FFB800] hover:underline sm:inline-flex"
          >
            Усі бренди
            <svg aria-hidden className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/*
          Дванадцять колонок на десктопі: великий банер займає шість, компактний
          — три. На телефоні сітка з двох колонок, у якій великий банер іде на
          всю ширину, а компактні стають парами.
        */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-12">
          {brands.map((b) => (
            <BrandBanner key={b.slug} brand={b} />
          ))}
        </div>
      </div>
    </section>
  );
}

function BrandBanner({ brand: b }: { brand: ShowcaseBrand }) {
  const large = b.tier === "large";
  const ink = inkOn(b.accent);
  const photos = b.photos.slice(0, large ? 3 : 1);

  /*
   * Три шари замість однієї заливки — інакше банер виглядає як кольоровий
   * прямокутник, а не як полиця бренда.
   *
   * Зверху вниз: м'який відблиск у лівому верхньому куті (там, де напис) —
   * він дає світлу «пляму» й відчуття об'єму; притемнення знизу, яке
   * притискає банер до сторінки; і власне фірмова пара кольорів по діагоналі.
   *
   * Відблиск світлий на темних банерах і темний на світлих — біле по білому
   * (APRO) не видно, а чорне по чорному (СИЛА, POLAX) з'їдало б кут.
   */
  const glare = ink === INK_LIGHT
    ? "radial-gradient(120% 120% at 6% 0%, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 58%)"
    : "radial-gradient(120% 120% at 6% 0%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 58%)";

  return (
    <Link
      href={`/brand/${b.slug}`}
      aria-label={`${b.name} — ${b.tagline}, ${formatCount(b.count, POSITIONS)}`}
      className={`brand-banner reveal group relative flex cursor-pointer overflow-hidden rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A0A0A] ${
        large
          ? "col-span-2 min-h-[196px] sm:min-h-[248px] lg:col-span-6"
          : "col-span-1 min-h-[132px] sm:min-h-[168px] lg:col-span-3"
      }`}
      /*
       * Колір під написом — окремим backgroundColor, а не тільки першою
       * зупинкою градієнта: за ним перевіряють контраст напису і тести, і
       * людина в інструментах браузера.
       */
      style={{
        backgroundColor: b.accent,
        backgroundImage: [
          glare,
          "linear-gradient(to top, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0) 38%)",
          `linear-gradient(128deg, ${b.accent} 0%, ${b.accent} 22%, ${b.accentTo} 88%)`,
        ].join(", "),
      }}
    >
      <div
        className={`relative z-10 flex min-w-0 flex-col justify-between ${
          large ? "flex-1 p-4 sm:p-6" : "flex-1 p-3.5 sm:p-4"
        }`}
      >
        <div className={large ? "max-w-[58%]" : "max-w-[62%]"}>
          {b.logoUrl ? (
            /*
              Логотип на білій плашці: майже всі вони намальовані для світлого
              тла, і на фірмовому кольорі темні контури зливаються.

              unoptimized обовʼязково — частина логотипів це SVG, а оптимізатор
              Next без dangerouslyAllowSVG їх не віддає зовсім. Оптимізувати тут
              однаково нічого: файли важать одиниці кілобайтів.
            */
            <span className="inline-flex items-center rounded-lg bg-white px-2 py-1.5 shadow-[0_1px_3px_rgba(10,10,10,0.12)]">
              <Image
                src={b.logoUrl}
                alt={b.name}
                width={168}
                height={56}
                unoptimized
                className={`w-auto object-contain ${large ? "h-6 sm:h-8" : "h-5 sm:h-6"}`}
              />
            </span>
          ) : (
            /*
              Логотипа немає — пишемо назву. «Схожий» логотип малювати не можна
              (чужа торгова марка), а розтягнутий SVG із написом Arial, який
              лежить у public/brands, читається гірше за звичайний напис.
            */
            <span
              className={`block font-black uppercase leading-none tracking-tight ${
                large ? "text-2xl sm:text-[32px]" : "text-lg sm:text-xl"
              }`}
              style={{ color: b.wordmark ?? ink }}
            >
              {b.name}
            </span>
          )}

          {/*
            На компактній картці слоган зʼявляється лише з планшета: у
            двоколонковій сітці телефона на нього лишається сто пікселів, і
            «Монтажна хімія, кріплення та…» обривалося на півслові — обрізаний
            уламок фрази читається як помилка, а не як опис.
          */}
          <p
            className={`mt-2 leading-snug opacity-80 ${
              large ? "line-clamp-2 text-[13px] sm:text-sm" : "hidden text-xs sm:line-clamp-2"
            }`}
            style={{ color: ink }}
          >
            {b.tagline}
          </p>
        </div>

        <span
          className={`mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 font-bold tabular-nums text-[#0A0A0A] transition-colors duration-200 group-hover:bg-[#0A0A0A] group-hover:text-white ${
            large ? "text-[11px] sm:text-xs" : "text-[10px] sm:text-[11px]"
          }`}
        >
          {formatCount(b.count, POSITIONS)}
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

      {photos.length > 0 && (
        <div
          aria-hidden
          className={`pointer-events-none absolute bottom-0 right-0 h-full ${
            large ? "w-[46%]" : "w-[38%]"
          }`}
        >
          {photos.map((src, i) => (
            /*
              Віяло: кожна наступна плитка трохи вище, більша й повернута в
              інший бік. Кути й зсуви — інлайн, бо залежать від позиції в
              масиві; Tailwind не збирає утиліти з рантайкових значень.
            */
            <span
              key={src}
              className={`brand-collage-tile absolute overflow-hidden rounded-xl bg-white shadow-[0_6px_18px_-6px_rgba(10,10,10,0.45)] ${
                large ? "h-[50%] w-[50%] sm:h-[54%] sm:w-[52%]" : "h-[56%] w-[84%]"
              }`}
              /*
               * Віяло відступає від краю банера: плитки повернуті, і кут
               * поверненої плитки виходить за її ж прямокутник — притиснуті
               * до краю, вони зрізались об нього.
               */
              style={{
                right: `${(large ? 6 : 8) + i * (large ? 13 : 0)}%`,
                bottom: `${(large ? 10 : 12) + i * (large ? 9 : 0)}%`,
                // Кут живе змінною, бо його доводиться повторювати в :hover
                // (див. .brand-collage-tile у globals.css).
                ["--tile-rotate" as string]: `${large ? [-7, 2, 9][i] ?? 0 : 0}deg`,
                transform: "rotate(var(--tile-rotate, 0deg))",
                zIndex: photos.length - i,
                // Плитки розлітаються не разом, а одна за одною.
                transitionDelay: `${i * 45}ms`,
              }}
            >
              <Image
                src={src}
                alt=""
                width={220}
                height={220}
                sizes="(max-width: 640px) 40vw, 220px"
                className="h-full w-full object-contain p-1.5"
              />
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
