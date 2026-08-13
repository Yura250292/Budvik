export const revalidate = 3600;

import Link from "next/link";
import { getBrandTree, getBrandTypes } from "@/lib/catalog/brand-tree";
import { BRANDS } from "@/lib/brands";
import BrandLogo from "@/components/catalog/BrandLogo";
import { SalesHeader } from "@/components/sales/SalesHeader";

/**
 * Зміст каталогу в кабінеті торгового.
 *
 * Замінює вісім паперових каталогів різних фірм, які торговий возить у машині
 * і гортає перед клієнтом. Тому головний екран — не сітка товарів, а саме
 * зміст: бренд, під ним групи товарів, кожна прямим посиланням у вже
 * відфільтрований список. Від питання клієнта до потрібної сторінки — один
 * дотик, як у паперовому каталозі з закладками, тільки без восьми томів.
 *
 * Живе всередині /sales, а не в загальному /catalog, бо кореневий layout
 * підставляє шапку й нижнє меню магазину — торговий втратив би свою навігацію.
 */
export default async function SalesCatalogPage() {
  const tree = await getBrandTree();

  // Розкладку на групи вантажимо для великих брендів: у дрібних сам бренд і є
  // групою, а 114 проходів по номенклатурі сторінку лише сповільнять.
  const withTypes = tree.main.slice(0, 12);
  const typesByBrand = await Promise.all(withTypes.map((b) => getBrandTypes(b.slug)));
  const logoBySlug = new Map(BRANDS.map((b) => [b.slug.toLowerCase(), b]));

  return (
    <div className="min-h-screen bg-background">
      <SalesHeader title="Каталог" subtitle={`${tree.total.toLocaleString("uk-UA")} позицій`} />

      <div className="mx-auto max-w-lg px-4 pt-4">
        <Link
          href="/sales/catalog/list"
          className="mb-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#FFD600] px-4 text-sm font-bold text-[#0A0A0A] active:bg-[#FFC400]"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Пошук і фільтри по всьому каталогу
        </Link>

        {/* Швидкий перехід — рядок брендів угорі, як закладки в каталозі */}
        <div className="mb-4 rounded-xl border border-g100 bg-white p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-g400">
            Швидкий перехід
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tree.main.slice(0, 24).map((b) => (
              <a
                key={b.id}
                href={`#brand-${b.slug}`}
                className="rounded-full border border-g200 bg-white px-3 py-1.5 text-xs font-medium text-g600 active:bg-g50"
              >
                {b.name}
                <span className="ml-1.5 text-g400">{b.count}</span>
              </a>
            ))}
          </div>
        </div>

        {/* Головні бренди з групами товарів */}
        <div className="space-y-3">
          {withTypes.map((brand, i) => {
            const types = typesByBrand[i];
            const logo = logoBySlug.get(brand.slug.toLowerCase());

            return (
              <section
                key={brand.id}
                id={`brand-${brand.slug}`}
                className="scroll-mt-4 overflow-hidden rounded-xl border border-g100 bg-white"
              >
                <div className="flex items-center gap-3 border-b border-g100 px-3 py-3">
                  <BrandLogo name={brand.name} logo={logo?.logo} color={brand.color} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-bold text-[#0A0A0A]">{brand.name}</div>
                    <div className="text-xs text-g400">{brand.count.toLocaleString("uk-UA")} позицій</div>
                  </div>
                  <Link
                    href={`/sales/catalog/list?brand=${brand.slug}`}
                    className="flex min-h-11 flex-shrink-0 items-center rounded-[10px] border border-g300 px-3 text-xs font-semibold text-[#1A1A1A] active:bg-g50"
                  >
                    Усі
                  </Link>
                </div>

                {types.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-3">
                    {types.map((t) => (
                      <Link
                        key={t.key}
                        href={`/sales/catalog/list?brand=${brand.slug}&type=${encodeURIComponent(t.key)}`}
                        className="flex min-h-11 items-center rounded-lg border border-g100 bg-g50 px-3 text-sm text-[#1A1A1A] active:bg-[#FFD600]/20"
                      >
                        {t.label}
                        <span className="ml-1.5 text-xs text-g400">{t.count}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Решта брендів */}
        <section className="mt-3 overflow-hidden rounded-xl border border-g100 bg-white">
          <div className="border-b border-g100 px-3 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#0A0A0A]">Інші бренди</h2>
          </div>
          <div className="flex flex-wrap gap-1.5 p-3">
            {tree.main.slice(withTypes.length).map((b) => (
              <Link
                key={b.id}
                href={`/sales/catalog/list?brand=${b.slug}`}
                className="flex min-h-11 items-center rounded-lg border border-g100 bg-g50 px-3 text-sm text-[#1A1A1A] active:bg-[#FFD600]/20"
              >
                {b.name}
                <span className="ml-1.5 text-xs text-g400">{b.count}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Дрібні бренди й товари без бренда — щоб жодна позиція не була недосяжною */}
        <section className="mt-3 overflow-hidden rounded-xl border border-g100 bg-white">
          <div className="border-b border-g100 px-3 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#0A0A0A]">
              Дрібні бренди <span className="font-normal text-g400">({tree.tail.length})</span>
            </h2>
          </div>
          <div className="flex flex-wrap gap-1.5 p-3">
            {tree.tail.map((b) => (
              <Link
                key={b.id}
                href={`/sales/catalog/list?brand=${b.slug}`}
                className="rounded-lg border border-g100 px-2.5 py-2 text-xs text-g600 active:bg-g50"
              >
                {b.name}
                <span className="ml-1 text-g400">{b.count}</span>
              </Link>
            ))}
            <Link
              href="/sales/catalog/list?brand=none"
              className="rounded-lg border border-g300 bg-g50 px-2.5 py-2 text-xs font-medium text-[#1A1A1A] active:bg-g100"
            >
              Без бренда
              <span className="ml-1 text-g400">{tree.unbranded}</span>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
