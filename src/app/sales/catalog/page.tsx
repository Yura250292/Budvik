export const revalidate = 3600;

import Link from "next/link";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { SalesQrShare } from "@/components/sales/SalesQrShare";
import { getCatalogToc } from "@/lib/catalog/sections";
import { getBrandTree } from "@/lib/catalog/brand-tree";

/**
 * Зміст каталогу в кабінеті — заміна восьми паперовим каталогам у машині.
 *
 * Побудований як зміст паперового каталогу постачальника: розділ, під ним
 * групи товарів із кількістю позицій, кожна прямим посиланням у вже
 * відфільтрований список. Клієнт питає «валики є?» — торговий відкриває
 * «Малярний інструмент» і бачить рядок «Валики 282».
 *
 * Групування за призначенням, а не за брендом: бренд лишається фільтром у
 * самому списку, але шукати ним товар незручно — це відповідь на інше
 * питання.
 *
 * Живе всередині /sales, а не в загальному /catalog, бо кореневий layout
 * підставляє шапку й нижнє меню магазину — торговий втратив би навігацію.
 */
export default async function SalesCatalogPage() {
  const [toc, tree] = await Promise.all([getCatalogToc(), getBrandTree()]);

  return (
    <div className="min-h-screen bg-background">
      <SalesHeader title="Каталог" subtitle={`${toc.total.toLocaleString("uk-UA")} позицій`} />

      {/* max-w-lg на телефоні, ширше на планшеті — його тримають горизонтально */}
      <div className="mx-auto max-w-lg px-4 pt-4 md:max-w-5xl lg:max-w-6xl">
        <Link
          href="/sales/catalog/list"
          className="mb-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#FFD600] px-4 text-sm font-bold text-[#0A0A0A] active:bg-[#FFC400]"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Пошук і фільтри по всьому каталогу
        </Link>

        <SalesQrShare />

        {/* Закладки розділів */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {toc.sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-g200 bg-white px-3 text-xs font-medium text-g600 active:bg-g50"
            >
              <span>{s.icon}</span>
              {s.title}
            </a>
          ))}
        </div>

        {/*
          Колонки через CSS columns, а не grid: розділи різної висоти, і grid
          лишав би під короткими порожні діри. На телефоні одна колонка.
        */}
        <div className="gap-x-8 md:columns-2 lg:columns-3">
          {toc.sections.map((section) => (
            <section key={section.id} id={section.id} className="mb-6 break-inside-avoid scroll-mt-4">
              {/* Заголовок веде у весь розділ: клієнт частіше питає «що є з
                  малярного», ніж конкретно про валики. Числа тут немає —
                  фільтр шукає підрядок і дає більше, ніж сума рядків */}
              <Link
                href={`/sales/catalog/list?section=${encodeURIComponent(section.id)}`}
                className="mb-2 flex min-h-11 items-center gap-2 border-b border-g100 pb-1.5 active:bg-[#FFD600]/10"
              >
                <span className="text-base">{section.icon}</span>
                <span className="flex-1 text-base font-bold leading-tight text-[#0A0A0A]">
                  {section.title}
                </span>
                <span className="text-xs font-medium text-g400">усі →</span>
              </Link>

              <ul>
                {section.lines.map((line) => (
                  <li key={line.key}>
                    <Link
                      href={`/sales/catalog/list?type=${encodeURIComponent(line.key)}`}
                      className="flex min-h-11 items-baseline gap-2 rounded px-1.5 py-1 active:bg-[#FFD600]/15"
                    >
                      <span className="self-center text-sm text-[#1A1A1A]">{line.label}</span>
                      <span className="min-w-4 flex-1 self-center border-b border-dotted border-g300" />
                      <span className="self-center text-xs tabular-nums text-g400">{line.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {toc.other.length > 0 && (
            <section className="mb-6 break-inside-avoid">
              <h2 className="mb-2 flex items-baseline gap-2 border-b border-g100 pb-1.5">
                <span className="text-base">📦</span>
                <span className="flex-1 text-base font-bold leading-tight text-[#0A0A0A]">Інші групи</span>
              </h2>
              <ul>
                {toc.other.map((line) => (
                  <li key={line.key}>
                    <Link
                      href={`/sales/catalog/list?type=${encodeURIComponent(line.key)}`}
                      className="flex min-h-11 items-baseline gap-2 rounded px-1.5 py-1 active:bg-[#FFD600]/15"
                    >
                      <span className="self-center text-sm text-[#1A1A1A]">{line.label}</span>
                      <span className="min-w-4 flex-1 self-center border-b border-dotted border-g300" />
                      <span className="self-center text-xs tabular-nums text-g400">{line.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Бренди — другий вхід у ту саму номенклатуру */}
        <section className="mt-2 border-t-2 border-[#FFD600] pt-5">
          <h2 className="mb-3 text-base font-bold text-[#0A0A0A]">Бренди</h2>
          <div className="flex flex-wrap gap-1.5">
            {tree.main.map((b) => (
              <Link
                key={b.id}
                href={`/sales/catalog/list?brand=${b.slug}`}
                className="flex min-h-11 items-center rounded-lg border border-g100 bg-g50 px-3 text-sm text-[#1A1A1A] active:bg-[#FFD600]/20"
              >
                {b.name}
                <span className="ml-1.5 text-xs text-g400">{b.count}</span>
              </Link>
            ))}
            <Link
              href="/sales/catalog/list?brand=none"
              className="flex min-h-11 items-center rounded-lg border border-g300 px-3 text-sm font-medium text-g600 active:bg-g50"
            >
              Без бренда
              <span className="ml-1.5 text-xs text-g400">{tree.unbranded}</span>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
