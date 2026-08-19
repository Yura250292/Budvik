"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "motion/react";

/*
 * Секції-«стос» промо-сторінки на motion: цифра в'їжджає зліва, текст
 * знизу, фото товару слайдом справа — і плавно зумиться та довертається
 * в міру прокрутки (useScroll прив'язаний до самої секції). Sticky-стос
 * лишився чистим CSS. Це клієнтський лист /about — ISR сторінки живий,
 * motion не потрапляє в бандл каталогу.
 */

export type StoryPhoto = { slug: string; name: string; image: string } | null;

const STORY = [
  {
    num: "01",
    title: "Весь інструмент в одному місці",
    text: "Від шурупа до генератора: електро- та ручний інструмент, кріплення і витратні матеріали. Тисячі позицій у наявності на складі — каталог синхронізується з обліком, тож ціни й залишки завжди справжні.",
    dark: true,
    icon: (
      <svg className="draw-on-scroll h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path pathLength={1} d="M21 8l-9-5-9 5 9 5 9-5z" />
        <path pathLength={1} d="M3 8v8l9 5v-8" />
        <path pathLength={1} d="M21 8v8l-9 5" />
      </svg>
    ),
  },
  {
    num: "02",
    title: "Оптовикам — особливі умови",
    text: "Персональні ціни, окремий кабінет і власний торговий менеджер, який веде ваше замовлення від заявки до відвантаження.",
    dark: false,
    icon: (
      <svg className="draw-on-scroll h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path pathLength={1} d="M19 5L5 19" />
        <circle pathLength={1} cx="6.5" cy="6.5" r="2.5" />
        <circle pathLength={1} cx="17.5" cy="17.5" r="2.5" />
      </svg>
    ),
  },
  {
    num: "03",
    title: "Доставка власним транспортом",
    text: "Розвозимо замовлення по Львову та області своїми машинами — швидко, дбайливо і без посередників.",
    dark: true,
    icon: (
      <svg className="draw-on-scroll h-14 w-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path pathLength={1} d="M1 7h13v9H1z" />
        <path pathLength={1} d="M14 10h4l3 3v3h-7" />
        <circle pathLength={1} cx="5.5" cy="18" r="1.8" />
        <circle pathLength={1} cx="17.5" cy="18" r="1.8" />
      </svg>
    ),
  },
];

function Panel({ s, photo }: { s: (typeof STORY)[number]; photo: StoryPhoto }) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // Фото зумиться і довертається, поки секція їде крізь в'юпорт
  const photoScale = useTransform(scrollYProgress, [0, 0.5, 1], [0.85, 1, 1.12]);
  const photoRotate = useTransform(scrollYProgress, [0, 1], [7, -3]);

  return (
    <section
      ref={ref}
      className={`sticky top-0 flex min-h-screen items-center overflow-hidden ${
        s.dark ? "bg-[#0A0A0A] text-white" : "bg-[#FFD600] text-[#0A0A0A]"
      }`}
    >
      {s.dark && <div aria-hidden className="hero-blueprint absolute inset-0" />}
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-20 sm:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_auto] lg:gap-12">
        <motion.span
          aria-hidden
          initial={{ opacity: 0, x: -80 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ amount: 0.4 }}
          transition={{ type: "spring", stiffness: 70, damping: 18 }}
          className={`text-[clamp(5rem,16vw,12rem)] font-black leading-none ${
            s.dark ? "text-white/10" : "text-[#0A0A0A]/10"
          }`}
        >
          {s.num}
        </motion.span>

        <motion.div
          initial={{ opacity: 0, y: 48 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ amount: 0.4 }}
          transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.1 }}
          className="self-center"
        >
          <div className={s.dark ? "text-[#FFD600]" : "text-[#0A0A0A]"}>{s.icon}</div>
          <h2 className="mt-5 text-3xl font-black tracking-tight sm:text-5xl">{s.title}</h2>
          <p className={`mt-5 max-w-xl text-base leading-relaxed sm:text-lg ${s.dark ? "text-[#DADADA]" : "text-[#1A1A1A]"}`}>
            {s.text}
          </p>
        </motion.div>

        {photo && (
          <motion.div
            initial={{ opacity: 0, x: 120, rotate: 10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ amount: 0.3 }}
            transition={{ type: "spring", stiffness: 60, damping: 16, delay: 0.15 }}
            style={reduced ? undefined : { scale: photoScale, rotate: photoRotate }}
            className="justify-self-center sm:col-span-2 lg:col-span-1 lg:justify-self-end"
          >
            <Link
              href={`/catalog/${photo.slug}`}
              className="block w-52 rounded-2xl bg-white p-4 sm:w-64 lg:w-72"
              style={{
                boxShadow: s.dark
                  ? "0 24px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,214,0,0.3)"
                  : "0 24px 70px rgba(0,0,0,0.25)",
              }}
            >
              <Image
                src={photo.image}
                alt={photo.name}
                width={280}
                height={280}
                sizes="288px"
                className="h-44 w-full object-contain sm:h-56"
              />
            </Link>
          </motion.div>
        )}
      </div>
    </section>
  );
}

export default function StoryPanels({ photos }: { photos: StoryPhoto[] }) {
  return (
    <div>
      {STORY.map((s, i) => (
        <Panel key={s.num} s={s} photo={photos[i] ?? null} />
      ))}
    </div>
  );
}
