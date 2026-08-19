/*
 * Промо-сторінка «Про нас» — окрема wow-вітрина бренду.
 *
 * Власник хотів «сайт як анімовані сайти», але головна мусить лишатись
 * компактною і продавати. Тож scroll-сценарій живе тут: буквене вльотання
 * заголовка, шари й пляма світла за курсором (MouseFx), типографічна
 * стрічка, лічильники, секції-«стос» (position: sticky), іконки, що самі
 * домальовуються при прокрутці, і «магнітна» CTA. Все — CSS + три крихітні
 * клієнтські листи; сторінка серверна та ISR, як і решта вітрини.
 */
export const revalidate = 3600;

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import BrandCard from "@/components/BrandCard";
import CountUp from "@/components/CountUp";
import MouseFx from "@/components/promo/MouseFx";
import Magnetic from "@/components/promo/Magnetic";
import StoryPanels, { type StoryPhoto } from "@/components/promo/StoryPanels";
import ProductStrip, { type StripProduct } from "@/components/promo/ProductStrip";
import { BRANDS } from "@/lib/brands";
import { getBrandTree } from "@/lib/catalog/brand-tree";

/*
 * Фото до скрол-секцій підібрані вручну (передивлялись очима: студійні,
 * білий фон, без водяних знаків). Якщо товар зникне з продажу — секція
 * просто лишиться без фото, нічого не ламається.
 */
const STORY_PHOTO_SLUGS = [
  "apro-dryl-shurupovert-20hdk-20-v-bez-akb-bez-zp-keys",
  "apro-mashyna-shlifuval-na-kutova-180-2300-prm-bolharka-4088",
  "sigma-henerator-benzynovyy-5-0-5-5kvt-4-kh-taktnyy-ruchnyy-pusk-2996",
];

export const metadata = {
  title: "Про БУДВІК27 — Ваш світ інструментів",
  description:
    "БУДВІК27 — магазин електро- та ручного інструменту у Львові: тисячі позицій у наявності, оптові умови, доставка власним транспортом по Львову та області.",
  alternates: { canonical: "/about" },
};

const MARQUEE_ITEMS = [
  "ЕЛЕКТРОІНСТРУМЕНТ",
  "РУЧНИЙ ІНСТРУМЕНТ",
  "КРІПЛЕННЯ",
  "САДОВА ТЕХНІКА",
  "ГЕНЕРАТОРИ",
  "ВИТРАТНІ МАТЕРІАЛИ",
];

/* Контурні інструменти, що плавають у героя і зсуваються за курсором */
function FloatingTool({ className, depth, children }: {
  className: string;
  depth: number;
  children: React.ReactNode;
}) {
  return (
    <div aria-hidden className={`mouse-layer absolute hidden md:block ${className}`} style={{ "--depth": depth } as React.CSSProperties}>
      <div className="viking-float text-[#FFD600]/15">{children}</div>
    </div>
  );
}

export default async function AboutPage() {
  const [productCount, brandTree, stripRows, storyRows] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    getBrandTree(),
    prisma.product.findMany({
      where: {
        isActive: true,
        stock: { gt: 0 },
        price: { gte: 500 },
        AND: [{ image: { not: null } }, { NOT: { image: "" } }],
        OR: ["шуруповерт", "болгарк", "перфоратор", "генератор", "пил"].map((kw) => ({
          name: { contains: kw, mode: "insensitive" as const },
        })),
      },
      select: { slug: true, name: true, image: true, price: true },
      take: 10,
      orderBy: { price: "desc" },
    }),
    prisma.product.findMany({
      where: { slug: { in: STORY_PHOTO_SLUGS }, isActive: true },
      select: { slug: true, name: true, image: true },
    }),
  ]);

  const storyBySlug = new Map(storyRows.map((r) => [r.slug, r]));
  const storyPhotos: StoryPhoto[] = STORY_PHOTO_SLUGS.map((slug) => {
    const r = storyBySlug.get(slug);
    return r?.image ? { slug: r.slug, name: r.name, image: r.image } : null;
  });
  const stripProducts: StripProduct[] = stripRows.filter((p) => p.image) as StripProduct[];

  const countBySlug = new Map(
    brandTree.main.concat(brandTree.tail).map((b) => [b.slug.toLowerCase(), b.count])
  );
  const activeBrands = BRANDS.filter((b) => (countBySlug.get(b.slug.toLowerCase()) || 0) > 0);
  const marqueeRow = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS];

  return (
    <div className="bg-[#0A0A0A]">
      {/* Повноекранний герой: літери вльотають по черзі, шари ходять за мишкою */}
      <MouseFx className="relative flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center overflow-hidden text-white">
        <div aria-hidden className="hero-blueprint mouse-layer absolute -inset-6" style={{ "--depth": 12 } as React.CSSProperties} />
        <div aria-hidden className="cursor-glow absolute inset-0" />
        <FloatingTool className="left-[8%] top-[18%]" depth={34}>
          <svg className="h-20 w-20 rotate-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round">
            <path d="M10 22V8M5 8V3l3-2M15 8V3l-3-2M5 8h10" />
          </svg>
        </FloatingTool>
        <FloatingTool className="right-[10%] top-[26%]" depth={26}>
          <svg className="h-24 w-24 -rotate-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round">
            <path d="M4 20L14 10M11 4h9v5M11 4l3 3M20 9l-3-3" />
          </svg>
        </FloatingTool>
        <FloatingTool className="bottom-[16%] left-[16%]" depth={20}>
          <svg className="h-16 w-16 rotate-45" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round">
            <path d="M10 22l1-12M13 22l-1-12M8 10h8M9 10V4h6v6" />
          </svg>
        </FloatingTool>
        <div className="relative px-4 text-center [perspective:800px]">
          <p className="hero-rise mb-3 text-sm font-semibold uppercase tracking-[0.35em] text-[#9E9E9E]">
            Львів · магазин інструментів
          </p>
          <h1 className="text-[clamp(3.5rem,14vw,11rem)] font-black leading-none tracking-tight" aria-label="БУДВІК27">
            {"БУДВІК27".split("").map((ch, i) => (
              <span
                key={i}
                aria-hidden
                className="letter-rise logo-text-animated"
                style={{ animationDelay: `${150 + i * 70}ms` }}
              >
                {ch}
              </span>
            ))}
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
      </MouseFx>

      {/* Типографічна стрічка: два ряди контурного тексту в різні боки */}
      <section aria-hidden className="overflow-hidden border-y border-white/10 bg-[#0D0D0D] py-6">
        <div className="promo-marquee flex w-max items-center gap-10 whitespace-nowrap">
          {marqueeRow.map((t, i) => (
            <span key={i} className="promo-outline-text text-[clamp(2.2rem,7vw,5rem)] font-black leading-none">
              {t} <span className="text-[#FFD600]">·</span>
            </span>
          ))}
        </div>
        <div className="promo-marquee promo-marquee--reverse mt-2 flex w-max items-center gap-10 whitespace-nowrap">
          {marqueeRow.map((t, i) => (
            <span key={i} className="text-[clamp(2.2rem,7vw,5rem)] font-black leading-none text-white/5">
              {t} <span className="text-[#FFD600]/30">·</span>
            </span>
          ))}
        </div>
      </section>

      {/* Лічильники */}
      <section className="relative overflow-hidden bg-[#111] py-16 text-white sm:py-24">
        <div aria-hidden className="parallax-down absolute -right-24 top-0 h-72 w-72 rounded-full bg-[#FFD600]/10 blur-3xl" />
        <div aria-hidden className="parallax-up absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-[#FFD600]/5 blur-3xl" />
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-4 text-center sm:grid-cols-3">
          <div className="zoom-in">
            <p className="text-4xl font-black text-[#FFD600] sm:text-6xl">
              <CountUp to={productCount} suffix="+" />
            </p>
            <p className="mt-2 text-sm text-[#9E9E9E] sm:text-base">товарів у каталозі</p>
          </div>
          <div className="zoom-in">
            <p className="text-4xl font-black text-[#FFD600] sm:text-6xl">
              <CountUp to={activeBrands.length} />
            </p>
            <p className="mt-2 text-sm text-[#9E9E9E] sm:text-base">брендів у наявності</p>
          </div>
          <div className="zoom-in">
            <p className="text-4xl font-black text-[#FFD600] sm:text-6xl">24/7</p>
            <p className="mt-2 text-sm text-[#9E9E9E] sm:text-base">каталог і замовлення онлайн</p>
          </div>
        </div>
      </section>

      {/* Секції-«стос» з фото товарів: слайди і зум за скролом (motion) */}
      <StoryPanels photos={storyPhotos} />

      {/* Драг-стрічка товарів */}
      <section className="relative overflow-hidden bg-[#F7F7F7] py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="reveal text-center text-3xl font-black tracking-tight text-[#0A0A0A] sm:text-5xl">
            Живий каталог
          </h2>
          <p className="reveal mb-10 mt-3 text-center text-[#6B7280]">
            Потягніть стрічку вбік — і клацніть товар, що сподобався
          </p>
          <ProductStrip products={stripProducts} />
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

      {/* CTA: пляма світла за курсором + магнітна кнопка */}
      <MouseFx className="relative overflow-hidden bg-[#0A0A0A] py-20 text-center text-white sm:py-28">
        <div aria-hidden className="cursor-glow absolute inset-0" />
        <div className="relative px-4">
          <h2 className="zoom-in text-3xl font-black tracking-tight sm:text-5xl">
            Потрібен інструмент? Він уже на складі.
          </h2>
          <Magnetic className="mt-8">
            <Link href="/catalog" className="btn-primary btn-lift inline-block px-10 py-4 text-base font-bold">
              Перейти до каталогу
            </Link>
          </Magnetic>
        </div>
      </MouseFx>
    </div>
  );
}
