export const revalidate = 3600;

import Link from "next/link";
import { getCatalogToc } from "@/lib/catalog/sections";
import { getBrandTree } from "@/lib/catalog/brand-tree";

export const metadata = {
  title: "Зміст каталогу — Budvik27",
  description: "Уся номенклатура за групами товарів",
};

/**
 * Зміст каталогу за зразком паперових каталогів постачальників.
 *
 * Розділ, під ним рядки-групи з кількістю позицій, кожен — посилання у вже
 * відфільтрований каталог. Дві-три колонки на широкому екрані: у паперовому
 * каталозі зміст займає розворот, і сенс саме в тому, щоб охопити його
 * поглядом цілком, а не гортати.
 *
 * Групування тут за призначенням, а не за брендом: клієнт питає «валики
 * є?», а не «що є в YATO». Бренд лишається фільтром у самому каталозі.
 *
 * Верстка тримає телефон нарівні з десктопом: клієнт приходить сюди за QR
 * від торгового, тобто майже завжди з телефона. Звідси тач-цілі min-h-11,
 * парні active: до кожного hover: і закладки горизонтальним скролом —
 * п'ятнадцять чіпів у flex-wrap з'їдали пів-екрана до першого розділу.
 */
export default async function CatalogTocPage() {
  const [toc, tree] = await Promise.all([getCatalogToc(), getBrandTree()]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 lg:py-10">
      <nav className="mb-4 flex items-center gap-2 text-sm text-[#9E9E9E]">
        <Link href="/" className="transition hover:text-[#FFB800]">Головна</Link>
        <span className="text-[#DADADA]">/</span>
        <Link href="/catalog" className="transition hover:text-[#FFB800]">Каталог</Link>
        <span className="text-[#DADADA]">/</span>
        <span className="font-medium text-[#0A0A0A]">Зміст</span>
      </nav>

      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b-2 border-[#FFD600] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0A0A0A] sm:text-3xl lg:text-4xl">
            Зміст каталогу
          </h1>
          <p className="mt-1.5 text-sm text-[#9E9E9E]">
            {toc.total.toLocaleString("uk-UA")} позицій · {toc.sections.length} розділів ·{" "}
            {(tree.main.length + tree.tail.length)} брендів
          </p>
        </div>
        <Link
          href="/catalog"
          className="flex min-h-11 w-full items-center justify-center rounded-[10px] bg-[#FFD600] px-6 text-sm font-bold text-[#0A0A0A] transition hover:bg-[#FFC400] active:bg-[#FFC400] sm:w-auto"
        >
          Відкрити весь каталог →
        </Link>
      </header>

      {/*
        Закладки розділів — горизонтальний скрол на телефоні, перенос на
        широкому: 15 чіпів у flex-wrap відсували перший розділ за межі екрана.
      */}
      <div className="scrollbar-hide -mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {toc.sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#E0E0E0] bg-white px-3 text-xs font-medium text-[#555] transition hover:border-[#FFD600] hover:bg-[#FFD600]/10 active:bg-[#FFD600]/15"
          >
            <span>{s.icon}</span>
            {s.title}
          </a>
        ))}
      </div>

      {/*
        Колонки через CSS columns, а не grid: розділи мають різну висоту, і
        grid лишав би під короткими діри в пів-екрана. columns розкладає їх
        суцільним потоком, як шпальти в друкованому змісті.
      */}
      <div className="gap-x-10 sm:columns-2 xl:columns-3">
        {toc.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="mb-7 break-inside-avoid scroll-mt-4"
          >
            {/*
              Заголовок розділу — теж посилання: «покажіть увесь малярний
              інструмент» частіше за «покажіть саме валики». ?type= розуміє
              список через кому, тож бекенд для цього вже готовий.

              Числа біля заголовка навмисно немає: зміст рахує за типом
              (перше слово назви), а фільтр шукає підрядок будь-де, тож
              «валик» ловить ще й «ручку для валика». Підсумок вийшов би
              більший за показаний — краще без цифри, ніж з неправдивою.
            */}
            <Link
              href={`/catalog?type=${encodeURIComponent(section.types.join(","))}`}
              className="group mb-2.5 flex min-h-11 items-center gap-2 border-b border-[#EFEFEF] pb-1.5 transition hover:border-[#FFD600] active:bg-[#FFD600]/10"
            >
              <span className="text-lg">{section.icon}</span>
              <span className="flex-1 text-base font-bold leading-tight text-[#0A0A0A] group-hover:underline sm:text-lg">
                {section.title}
              </span>
              <span className="text-xs font-medium text-[#9E9E9E] transition group-hover:text-[#0A0A0A]">
                усі →
              </span>
            </Link>

            <ul className="space-y-0.5">
              {section.lines.map((line) => (
                <li key={line.key}>
                  <Link
                    href={`/catalog?type=${encodeURIComponent(line.key)}`}
                    className="group flex min-h-11 items-baseline gap-2 rounded px-1.5 py-1 transition hover:bg-[#FFD600]/10 active:bg-[#FFD600]/15"
                  >
                    <span className="self-center text-sm text-[#1A1A1A] group-hover:text-[#0A0A0A] group-hover:underline">
                      {line.label}
                    </span>
                    {/* Крапкова лінійка до числа — так само, як у друкованому змісті */}
                    <span className="min-w-4 flex-1 self-center border-b border-dotted border-[#DADADA]" />
                    <span className="self-center text-xs tabular-nums text-[#9E9E9E]">{line.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {toc.other.length > 0 && (
          <section className="mb-7 break-inside-avoid">
            <h2 className="mb-2.5 flex items-baseline gap-2 border-b border-[#EFEFEF] pb-1.5">
              <span className="text-lg">📦</span>
              <span className="flex-1 text-lg font-bold leading-tight text-[#0A0A0A]">Інші групи</span>
            </h2>
            <ul className="space-y-0.5">
              {toc.other.map((line) => (
                <li key={line.key}>
                  <Link
                    href={`/catalog?type=${encodeURIComponent(line.key)}`}
                    className="group flex items-baseline gap-2 rounded px-1.5 py-1 transition hover:bg-[#FFD600]/10"
                  >
                    <span className="text-sm text-[#1A1A1A] group-hover:underline">{line.label}</span>
                    <span className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-[#DADADA]" />
                    <span className="text-xs tabular-nums text-[#9E9E9E]">{line.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Бренди окремим блоком: другий спосіб входу в ту саму номенклатуру */}
      <section className="mt-4 border-t-2 border-[#FFD600] pt-6">
        <h2 className="mb-3 text-lg font-bold text-[#0A0A0A]">Бренди</h2>
        <div className="flex flex-wrap gap-1.5">
          {tree.main.map((b) => (
            <Link
              key={b.id}
              href={`/catalog?brand=${b.slug}`}
              className="rounded-lg border border-[#EFEFEF] bg-[#FAFAFA] px-3 py-1.5 text-sm text-[#1A1A1A] transition hover:border-[#FFD600] hover:bg-[#FFD600]/10"
            >
              {b.name}
              <span className="ml-1.5 text-xs text-[#9E9E9E]">{b.count}</span>
            </Link>
          ))}
          <Link
            href="/catalog?brand=none"
            className="rounded-lg border border-[#DADADA] px-3 py-1.5 text-sm font-medium text-[#555] transition hover:border-[#FFD600]"
          >
            Без бренда
            <span className="ml-1.5 text-xs text-[#9E9E9E]">{tree.unbranded}</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
