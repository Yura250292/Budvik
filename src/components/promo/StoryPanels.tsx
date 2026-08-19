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

/*
 * Візуали секцій 02 і 03 — фірмові векторні сцени, а не фото товару:
 * власник просив, щоб картинка відповідала змісту («бус з написом
 * Будвік», «щось про знижки»), а AI-генерація з ключем безкоштовного
 * тарифу недоступна, та й кирилицю моделі калічать. Вектор дає точний
 * напис і анімується: у буса крутяться колеса й біжить розмітка,
 * бейджі знижок вистрибують пружиною і плавають.
 */

function VanScene() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 200 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ amount: 0.3 }}
      transition={{ type: "spring", stiffness: 45, damping: 14, delay: 0.15 }}
      className="w-72 justify-self-center sm:col-span-2 sm:w-96 lg:col-span-1 lg:w-[26rem] lg:justify-self-end"
    >
      <svg viewBox="0 0 520 280" role="img" aria-label="Бус доставки БУДВІК27">
        {/* Кузов */}
        <rect x="28" y="52" width="340" height="152" rx="14" fill="#FFD600" />
        {/* Кабіна з капотом */}
        <path d="M368 52 h52 q20 0 30 16 l26 44 q6 10 6 22 v56 q0 14 -14 14 h-100 z" fill="#FFD600" />
        {/* Лобове скло */}
        <path d="M388 66 h28 q12 0 18 10 l20 34 h-66 z" fill="#1A1A1A" />
        {/* Двері та ручка */}
        <line x1="368" y1="60" x2="368" y2="200" stroke="#E0BC00" strokeWidth="4" />
        <rect x="378" y="126" width="26" height="6" rx="3" fill="#1A1A1A" />
        {/* Нижня чорна спідниця */}
        <rect x="28" y="188" width="454" height="16" rx="8" fill="#1A1A1A" />
        {/* Фара і бампер */}
        <rect x="470" y="150" width="14" height="18" rx="4" fill="#FFF6C2" />
        <rect x="458" y="196" width="34" height="12" rx="6" fill="#333" />
        {/* Напис на борту */}
        <text x="52" y="134" fontFamily="var(--font-geist-sans), Arial, sans-serif" fontWeight="900" fontSize="52" fill="#0A0A0A" letterSpacing="2">
          БУДВІК27
        </text>
        <text x="55" y="166" fontFamily="var(--font-geist-sans), Arial, sans-serif" fontWeight="700" fontSize="18" fill="#1A1A1A">
          Ваш світ інструментів
        </text>
        {/* Колеса (обертаються) */}
        <g className="van-wheel">
          <circle cx="120" cy="212" r="34" fill="#1A1A1A" />
          <circle cx="120" cy="212" r="16" fill="#555" />
          <line x1="120" y1="200" x2="120" y2="224" stroke="#9E9E9E" strokeWidth="4" />
          <line x1="108" y1="212" x2="132" y2="212" stroke="#9E9E9E" strokeWidth="4" />
        </g>
        <g className="van-wheel">
          <circle cx="404" cy="212" r="34" fill="#1A1A1A" />
          <circle cx="404" cy="212" r="16" fill="#555" />
          <line x1="404" y1="200" x2="404" y2="224" stroke="#9E9E9E" strokeWidth="4" />
          <line x1="392" y1="212" x2="416" y2="212" stroke="#9E9E9E" strokeWidth="4" />
        </g>
        {/* Дорога: пунктир біжить назад */}
        <line className="van-road" x1="10" y1="262" x2="510" y2="262" stroke="#FFD600" strokeWidth="5" strokeLinecap="round" strokeDasharray="34 30" opacity="0.55" />
        {/* Лінії швидкості позаду */}
        <line x1="-6" y1="90" x2="40" y2="90" stroke="#FFD600" strokeWidth="5" strokeLinecap="round" opacity="0.35" />
        <line x1="-14" y1="130" x2="24" y2="130" stroke="#FFD600" strokeWidth="5" strokeLinecap="round" opacity="0.25" />
        <line x1="-4" y1="168" x2="34" y2="168" stroke="#FFD600" strokeWidth="5" strokeLinecap="round" opacity="0.35" />
      </svg>
    </motion.div>
  );
}

const DISCOUNT_CHIPS = [
  { label: "−10%", className: "-left-3 top-2", delay: 0.35 },
  { label: "−15%", className: "-right-4 top-16", delay: 0.5 },
  { label: "−20%", className: "-left-5 bottom-14", delay: 0.65 },
];

function WholesaleScene() {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, x: 120 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ amount: 0.3 }}
      transition={{ type: "spring", stiffness: 60, damping: 16, delay: 0.15 }}
      className="relative w-64 justify-self-center sm:col-span-2 sm:w-80 lg:col-span-1 lg:justify-self-end"
    >
      <svg viewBox="0 0 420 320" role="img" aria-label="Оптові палети з товаром">
        {/* Палета */}
        <rect x="40" y="278" width="340" height="14" rx="4" fill="#0A0A0A" />
        <rect x="56" y="292" width="30" height="16" fill="#1A1A1A" />
        <rect x="196" y="292" width="30" height="16" fill="#1A1A1A" />
        <rect x="336" y="292" width="30" height="16" fill="#1A1A1A" />
        {/* Велика коробка */}
        <rect x="56" y="140" width="180" height="138" rx="6" fill="#E8B27D" stroke="#B77B42" strokeWidth="3" />
        <line x1="146" y1="140" x2="146" y2="278" stroke="#C68B4E" strokeWidth="10" />
        <line x1="56" y1="176" x2="236" y2="176" stroke="#B77B42" strokeWidth="3" />
        {/* Середня коробка */}
        <rect x="248" y="170" width="126" height="108" rx="6" fill="#E8B27D" stroke="#B77B42" strokeWidth="3" />
        <line x1="311" y1="170" x2="311" y2="278" stroke="#C68B4E" strokeWidth="8" />
        {/* Верхня коробка */}
        <rect x="118" y="52" width="126" height="88" rx="6" fill="#F0C08A" stroke="#B77B42" strokeWidth="3" />
        <line x1="181" y1="52" x2="181" y2="140" stroke="#C68B4E" strokeWidth="8" />
        {/* Логотип на коробці */}
        <text x="76" y="236" fontFamily="var(--font-geist-sans), Arial, sans-serif" fontWeight="900" fontSize="26" fill="#7A4A1D">
          БУДВІК27
        </text>
        {/* Бирка «ОПТ» на верхній коробці */}
        <g transform="rotate(-8 192 40)">
          <rect x="150" y="16" width="86" height="44" rx="12" fill="#0A0A0A" />
          <text x="166" y="47" fontFamily="var(--font-geist-sans), Arial, sans-serif" fontWeight="900" fontSize="26" fill="#FFD600">
            ОПТ
          </text>
        </g>
      </svg>
      {DISCOUNT_CHIPS.map((chip) => (
        <motion.span
          key={chip.label}
          initial={{ scale: 0, rotate: -12 }}
          whileInView={{ scale: 1, rotate: 0 }}
          viewport={{ amount: 0.5 }}
          transition={{ type: "spring", stiffness: 260, damping: 14, delay: chip.delay }}
          className={`absolute ${chip.className}`}
        >
          <motion.span
            animate={reduced ? undefined : { y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: chip.delay }}
            className="block rounded-full bg-[#0A0A0A] px-4 py-2 text-lg font-black text-[#FFD600] shadow-xl"
          >
            {chip.label}
          </motion.span>
        </motion.span>
      ))}
    </motion.div>
  );
}

type StoryItem = {
  num: string;
  title: string;
  text: string;
  dark: boolean;
  icon: React.ReactNode;
  visual?: "wholesale" | "van";
};

const STORY: StoryItem[] = [
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
    visual: "wholesale" as const,
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
    visual: "van" as const,
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

function Panel({ s, photo }: { s: StoryItem; photo: StoryPhoto }) {
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

        {s.visual === "van" ? (
          <VanScene />
        ) : s.visual === "wholesale" ? (
          <WholesaleScene />
        ) : photo && (
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
