/*
 * Промо-сторінка «Про нас» — окрема wow-вітрина бренду.
 *
 * Власник хотів «сайт як анімовані сайти», але головна мусить лишатись
 * компактною і продавати. Тож scroll-сценарій живе тут: повноекранний
 * герой, лічильники, секції-«стос» (звичайний position: sticky — кожна
 * наступна накриває попередню), і вітрина карток з 3D-нахилом.
 * Все — CSS + два крихітні клієнтські листи (CountUp, ProductCard),
 * сторінка серверна та ISR, як і решта вітрини.
 */
export const revalidate = 3600;

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";
import BrandCard from "@/components/BrandCard";
import CountUp from "@/components/CountUp";
import { BRANDS } from "@/lib/brands";
import { getBrandTree } from "@/lib/catalog/brand-tree";

export const metadata = {
  title: "Про БУДВІК27 — Ваш світ інструментів",
  description:
    "БУДВІК27 — магазин електро- та ручного інструменту у Львові: тисячі позицій у наявності, оптові умови, доставка власним транспортом по Львову та області.",
  alternates: { canonical: "/about" },
};

const STORY = [
  {
    num: "01",
    title: "Весь інструмент в одному місці",
    text: "Від шурупа до генератора: електро- та ручний інструмент, кріплення і витратні матеріали. Тисячі позицій у наявності на складі — каталог синхронізується з обліком, тож ціни й залишки завжди справжні.",
    dark: true,
  },
  {
    num: "02",
    title: "Оптовикам — особливі умови",
    text: "Персональні ціни, окремий кабінет і власний торговий менеджер, який веде ваше замовлення від заявки до відвантаження.",
    dark: false,
  },
  {
    num: "03",
    title: "Доставка власним транспортом",
    text: "Розвозимо замовлення по Львову та області своїми машинами — швидко, дбайливо і без посередників.",
    dark: true,
  },
];

export default async function AboutPage() {
  const [productCount, brandTree, showcase] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    getBrandTree(),
    prisma.product.findMany({
      where: {
        isActive: true,
        stock: { gt: 0 },
        price: { gte: 500 },
        AND: [{ image: { not: null } }, { NOT: { image: "" } }],
        OR: ["шуруповерт", "болгарк", "перфоратор", "бензопил"].map((kw) => ({
          name: { contains: kw, mode: "insensitive" as const },
        })),
      },
      include: { category: true, brand: { select: { name: true } } },
      take: 4,
      orderBy: { price: "desc" },
    }),
  ]);

  const countBySlug = new Map(
    brandTree.main.concat(brandTree.tail).map((b) => [b.slug.toLowerCase(), b.count])
  );
  const activeBrands = BRANDS.filter((b) => (countBySlug.get(b.slug.toLowerCase()) || 0) > 0);

  return (
    <div className="bg-[#0A0A0A]">
      {/* Повноекранний герой */}
      <section className="relative flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center overflow-hidden text-white">
        <div aria-hidden className="hero-blueprint absolute inset-0" />
        <div aria-hidden className="hero-spotlight absolute inset-0" />
        <div className="relative px-4 text-center">
          <p className="hero-rise mb-3 text-sm font-semibold uppercase tracking-[0.35em] text-[#9E9E9E]">
            Львів · магазин інструментів
          </p>
          <h1 className="hero-rise hero-rise-2 logo-text-animated text-[clamp(3.5rem,14vw,11rem)] font-black leading-none tracking-tight">
            БУДВІК27
          </h1>
          <p className="hero-rise hero-rise-3 mx-auto mt-4 max-w-md text-base text-[#DADADA] sm:text-lg">
            Ваш світ інструментів — від шурупа до генератора
          </p>
        </div>
        <div aria-hidden className="scroll-hint absolute bottom-8 text-[#FFD600]">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* Лічильники */}
      <section className="relative overflow-hidden border-t border-white/10 bg-[#111] py-16 text-white sm:py-24">
        <div aria-hidden className="parallax-down absolute -right-24 top-0 h-72 w-72 rounded-full bg-[#FFD600]/10 blur-3xl" />
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-4 text-center sm:grid-cols-3">
          <div className="reveal">
            <p className="text-4xl font-black text-[#FFD600] sm:text-6xl">
              <CountUp to={productCount} suffix="+" />
            </p>
            <p className="mt-2 text-sm text-[#9E9E9E] sm:text-base">товарів у каталозі</p>
          </div>
          <div className="reveal">
            <p className="text-4xl font-black text-[#FFD600] sm:text-6xl">
              <CountUp to={activeBrands.length} />
            </p>
            <p className="mt-2 text-sm text-[#9E9E9E] sm:text-base">брендів у наявності</p>
          </div>
          <div className="reveal">
            <p className="text-4xl font-black text-[#FFD600] sm:text-6xl">24/7</p>
            <p className="mt-2 text-sm text-[#9E9E9E] sm:text-base">каталог і замовлення онлайн</p>
          </div>
        </div>
      </section>

      {/* Секції-«стос»: кожна наступна насувається на попередню */}
      <div>
        {STORY.map((s) => (
          <section
            key={s.num}
            className={`sticky top-0 flex min-h-screen items-center overflow-hidden ${
              s.dark ? "bg-[#0A0A0A] text-white" : "bg-[#FFD600] text-[#0A0A0A]"
            }`}
          >
            {s.dark && <div aria-hidden className="hero-blueprint absolute inset-0" />}
            <div className="relative mx-auto grid w-full max-w-6xl gap-6 px-4 py-20 sm:grid-cols-[auto_1fr] sm:gap-14">
              <span
                aria-hidden
                className={`parallax-up text-[clamp(5rem,18vw,13rem)] font-black leading-none ${
                  s.dark ? "text-white/10" : "text-[#0A0A0A]/10"
                }`}
              >
                {s.num}
              </span>
              <div className="reveal self-center">
                <h2 className="text-3xl font-black tracking-tight sm:text-5xl">{s.title}</h2>
                <p className={`mt-5 max-w-xl text-base leading-relaxed sm:text-lg ${s.dark ? "text-[#DADADA]" : "text-[#1A1A1A]"}`}>
                  {s.text}
                </p>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Вітрина з 3D-нахилом карток */}
      <section className="relative bg-[#F7F7F7] py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="reveal text-center text-3xl font-black tracking-tight text-[#0A0A0A] sm:text-5xl">
            Живий каталог
          </h2>
          <p className="reveal mt-3 text-center text-[#6B7280]">
            Наведіть на товар — фото нахиляється за курсором
          </p>
          <div className="mt-10 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4 md:gap-6">
            {showcase.map((product) => (
              <ProductCard key={product.id} {...product} category={product.category} />
            ))}
          </div>
        </div>
      </section>

      {/* Бренди */}
      <section className="bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="reveal mb-8 text-center text-3xl font-black tracking-tight text-[#0A0A0A] sm:text-4xl">
            Бренди, яким довіряють
          </h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {activeBrands.map((brand) => (
              <BrandCard key={brand.slug} brand={brand} count={countBySlug.get(brand.slug.toLowerCase()) || 0} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-[#0A0A0A] py-20 text-center text-white sm:py-28">
        <div aria-hidden className="hero-spotlight absolute inset-0" />
        <div className="relative px-4">
          <h2 className="reveal text-3xl font-black tracking-tight sm:text-5xl">
            Потрібен інструмент? Він уже на складі.
          </h2>
          <Link
            href="/catalog"
            className="btn-primary btn-lift reveal mt-8 inline-block px-10 py-4 text-base font-bold"
          >
            Перейти до каталогу
          </Link>
        </div>
      </section>
    </div>
  );
}
