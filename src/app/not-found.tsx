/**
 * Сторінка «не знайдено».
 *
 * Її не було взагалі, тож Next показував свою службову: «404 This page could
 * not be found» — англійською, без шапки в тілі й без жодного посилання назад.
 * Так виглядав будь-який одрук в адресі, будь-яке старе посилання з візитки
 * і сторінка каталогу за сотою.
 *
 * Тому тут не «помилка», а розвилка: поле пошуку, розділи каталогу й телефон.
 * Людина прийшла за інструментом — дамо їй дорогу до нього.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { SECTIONS, sectionHref } from "@/lib/catalog/sections";
import { SITE_CONTACTS } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: "Сторінку не знайдено",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  const featured = SECTIONS.filter((s) => s.featured);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-20">
      <p className="font-mono text-sm font-medium tracking-widest text-primary-dark">404</p>
      <h1 className="mt-2 text-2xl font-bold leading-tight text-[#0A0A0A] sm:text-4xl">
        Такої сторінки немає
      </h1>
      <p className="mt-3 max-w-xl text-[#6B6B6B]">
        Можливо, товар зняли з продажу або в посиланні є одрук. Пошук нижче шукає
        і за назвою, і за артикулом.
      </p>

      {/* Звичайна форма, а не клієнтський компонент: сторінка помилки має
          працювати навіть тоді, коли решта скриптів не завантажилась. */}
      <form action="/catalog" method="get" className="mt-7 flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          name="search"
          autoComplete="off"
          placeholder="Назва або артикул — «дриль», «GR-30030»"
          aria-label="Пошук товарів у каталозі"
          className="min-h-12 flex-1 rounded-xl border border-[#DADADA] bg-white px-4 text-[#0A0A0A] outline-none placeholder:text-[#9E9E9E] focus:border-[#FFD600] focus:ring-2 focus:ring-[#FFD600]/40"
        />
        <button
          type="submit"
          className="min-h-12 rounded-xl bg-[#FFD600] px-6 font-bold text-[#0A0A0A] transition hover:bg-[#FFC400] active:bg-[#FFB800]"
        >
          Шукати
        </button>
      </form>

      <nav aria-label="Розділи каталогу" className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#9E9E9E]">
          Або оберіть розділ
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {featured.map((s) => (
            <li key={s.id}>
              <Link
                href={sectionHref(s.id)}
                className="inline-flex min-h-11 items-center rounded-xl border border-[#EFEFEF] bg-white px-4 text-sm font-medium text-[#0A0A0A] transition hover:border-[#FFD600] hover:bg-[#FFFDF0]"
              >
                {s.title}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/catalog/zmist"
              className="inline-flex min-h-11 items-center rounded-xl border border-[#EFEFEF] bg-[#FAFAFA] px-4 text-sm font-medium text-[#6B6B6B] transition hover:border-[#DADADA]"
            >
              Весь зміст каталогу →
            </Link>
          </li>
        </ul>
      </nav>

      <p className="mt-10 border-t border-[#EFEFEF] pt-6 text-sm text-[#6B6B6B]">
        Не знаходите потрібного? Зателефонуйте —{" "}
        <a href={`tel:${SITE_CONTACTS.phone}`} className="font-semibold text-[#0A0A0A] underline decoration-[#FFD600] decoration-2 underline-offset-2">
          {SITE_CONTACTS.phoneDisplay}
        </a>
        , підберемо разом.
      </p>
    </div>
  );
}
