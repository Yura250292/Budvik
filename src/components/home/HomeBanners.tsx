"use client";

/**
 * Стрічка банерів першого екрана.
 *
 * Намальованих банерів у нас немає й не буде швидко — тому банер збирається
 * з того, що є: заголовок, підзаголовок і фотографія справжнього товару з
 * цієї ж добірки. Це чесніше за візуальну заглушку і не старіє: коли акція
 * закінчується, банер зникає разом із нею.
 *
 * Гортання — нативним overflow зі scroll-snap, а не бібліотекою каруселі:
 * на телефоні палець і так гортає, а на десктопі досить двох стрілок.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { isLight, shade } from "@/lib/color";

export interface HomeBanner {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  cta: string;
  /** Колір акценту банера. */
  color: string;
  image: string | null;
}

/** Пауза між автоперегортаннями. Достатньо, щоб прочитати банер, не поспішаючи. */
const AUTOPLAY_MS = 6000;

export default function HomeBanners({
  banners,
  className = "",
}: {
  banners: HomeBanner[];
  className?: string;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  /**
   * Автоперегортання зупиняється назавжди, щойно людина торкнулась стрічки:
   * банер, який їде сам, коли його читають, — найдратівливіший різновид
   * каруселі.
   */
  const [autoplay, setAutoplay] = useState(true);

  const scrollTo = useCallback((i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const card = rail.children[i] as HTMLElement | undefined;
    if (card) rail.scrollTo({ left: card.offsetLeft - rail.offsetLeft, behavior: "smooth" });
  }, []);

  /** Активний банер — той, чий лівий край найближчий до лівого краю стрічки. */
  const onScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < rail.children.length; i++) {
      const card = rail.children[i] as HTMLElement;
      const dist = Math.abs(card.offsetLeft - rail.offsetLeft - rail.scrollLeft);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setActive(best);
  }, []);

  useEffect(() => {
    if (!autoplay || banners.length < 2) return;
    // Хто просив систему не рухати зайвого — тому карусель не їде сама.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      const rail = railRef.current;
      if (!rail) return;
      const next = (active + 1) % banners.length;
      const card = rail.children[next] as HTMLElement | undefined;
      if (card) rail.scrollTo({ left: card.offsetLeft - rail.offsetLeft, behavior: "smooth" });
    }, AUTOPLAY_MS);
    return () => window.clearInterval(t);
  }, [active, autoplay, banners.length]);

  if (banners.length === 0) return null;

  const stop = () => setAutoplay(false);

  return (
    <div className={`relative ${className}`} onPointerDown={stop} onFocusCapture={stop}>
      <div
        ref={railRef}
        onScroll={onScroll}
        className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth"
      >
        {banners.map((b) => {
          /* Колір акценту заводить адміністратор одним полем, тож банер може
             виявитись і темним. Напис і кнопка підлаштовуються, інакше на
             темній акції чорний заголовок просто зникає. */
          const light = isLight(b.color);
          const ink = light ? "#0A0A0A" : "#FFFFFF";
          return (
          <Link
            key={b.id}
            href={b.href}
            className="group relative flex min-h-[188px] w-[86%] shrink-0 cursor-pointer snap-start overflow-hidden rounded-2xl sm:min-h-[228px] sm:w-[calc(50%-6px)]"
            style={{ background: `linear-gradient(135deg, ${b.color} 0%, ${shade(b.color)} 100%)` }}
          >
            <div className="relative z-10 flex flex-1 flex-col justify-between p-5 sm:p-6">
              <div className="max-w-[54%] sm:max-w-[60%]">
                <h3 className="text-lg font-extrabold leading-tight sm:text-2xl" style={{ color: ink }}>
                  {b.title}
                </h3>
                {b.subtitle && (
                  <p className="mt-1.5 text-[13px] leading-snug opacity-75 sm:text-sm" style={{ color: ink }}>
                    {b.subtitle}
                  </p>
                )}
              </div>
              <span
                className="inline-flex w-fit items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-bold transition-opacity duration-200 group-hover:opacity-85"
                style={{ backgroundColor: ink, color: light ? "#FFFFFF" : "#0A0A0A" }}
              >
                {b.cta}
                <svg aria-hidden className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
            {b.image && (
              /* Фото товару, а не декоративна графіка: банер має показувати те,
                 що за ним справді лежить.

                 mix-blend-multiply прибирає білу підкладку знімка: фотографії
                 з 1С зняті на білому тлі й у форматі без прозорості, тож без
                 цього на кольоровому банері висить білий прямокутник. Множення
                 працює лише на світлому тлі — на темному товар зникає, тому
                 темні банери лишаються з підкладкою. */
              <Image
                src={b.image}
                alt=""
                aria-hidden
                width={220}
                height={220}
                sizes="220px"
                className={`pointer-events-none absolute -right-1 bottom-0 h-[70%] w-auto max-w-[46%] object-contain transition-transform duration-500 ease-out group-hover:scale-105 sm:-right-2 sm:h-[74%] ${
                  isLight(b.color) ? "mix-blend-multiply" : "drop-shadow-xl"
                }`}
              />
            )}
          </Link>
          );
        })}
      </div>

      {banners.length > 1 && (
        <>
          <Arrow dir="left" onClick={() => scrollTo(Math.max(0, active - 1))} disabled={active === 0} />
          <Arrow
            dir="right"
            onClick={() => scrollTo(Math.min(banners.length - 1, active + 1))}
            disabled={active === banners.length - 1}
          />
          <div className="mt-3 flex justify-center gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                onClick={() => scrollTo(i)}
                aria-label={`Банер ${i + 1}: ${b.title}`}
                aria-current={i === active}
                className={`h-1.5 cursor-pointer rounded-full transition-all duration-200 ${
                  i === active ? "w-6 bg-[#0A0A0A]" : "w-1.5 bg-[#D4D4D4] hover:bg-[#9E9E9E]"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Arrow({
  dir,
  onClick,
  disabled,
}: {
  dir: "left" | "right";
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "Попередній банер" : "Наступний банер"}
      className={`absolute top-[38%] hidden h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-[#E5E5E5] bg-white/95 text-[#0A0A0A] shadow-md transition-colors duration-200 hover:bg-white disabled:cursor-default disabled:opacity-0 sm:flex ${
        dir === "left" ? "-left-4" : "-right-4"
      }`}
    >
      <svg aria-hidden className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={dir === "left" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"}
        />
      </svg>
    </button>
  );
}
