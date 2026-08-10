"use client";

import Link from "next/link";
import Image from "next/image";

/**
 * Спільна шапка кабінету торгового.
 *
 * До неї кожен екран секції малював свою: /sales, /sales/clients і
 * /sales/orders мали три схожі, але різні за відступами блоки — і жоден
 * не враховував safe-area. На айфоні з вирізом шапка заїжджала під
 * статус-бар, бо в корені стоїть viewportFit: "cover" (див.
 * src/app/layout.tsx): контент розтягується під вирізи, і відступ треба
 * ставити руками.
 *
 * env(safe-area-inset-top) інлайном, а не класом .safe-area-top з
 * globals.css: тут потрібна сума «свій відступ + виріз», а клас задає
 * тільки виріз і затер би 12px.
 *
 * Логотип — посилання на вітрину: торговому треба вміти подивитись
 * товар очима клієнта, і це єдиний вихід із секції, крім «Вийти».
 */
export function SalesHeader({
  title,
  subtitle,
  backTo,
  right,
  sticky = false,
}: {
  title: string;
  /** Дрібний рядок над заголовком (роль, ім'я, кількість). */
  subtitle?: string;
  /** Куди веде «назад». Немає — кнопки немає (це головна секції). */
  backTo?: string;
  /** Слот під кнопки справа: дзвіночок, «Вийти», лічильник. */
  right?: React.ReactNode;
  /** Головна прокручується разом із шапкою, списки — ні. */
  sticky?: boolean;
}) {
  return (
    <header
      className={sticky ? "sticky top-0 z-40" : "relative"}
      style={{
        background: "linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Золота лінія по верху — впізнаваний елемент секції */}
      <div
        style={{
          height: "2px",
          background: "linear-gradient(to right, transparent, #FFD600, transparent)",
        }}
      />

      <div
        className="mx-auto flex max-w-lg items-center gap-3 px-4"
        style={{
          paddingTop: "calc(12px + env(safe-area-inset-top, 0px))",
          paddingBottom: "12px",
        }}
      >
        {backTo ? (
          <Link
            href={backTo}
            aria-label="Назад"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.7)" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
        ) : (
          <Link href="/" aria-label="Перейти на сайт Budvik" className="shrink-0">
            <Image src="/logo-gold.png" alt="Budvik" width={36} height={36} className="h-9 w-auto" />
          </Link>
        )}

        <div className="min-w-0 flex-1">
          {subtitle && (
            <p
              className="truncate"
              style={{
                fontSize: "11px",
                color: "rgba(255,255,255,0.4)",
                letterSpacing: "1.5px",
                textTransform: "uppercase",
              }}
            >
              {subtitle}
            </p>
          )}
          <h1 className="truncate" style={{ fontSize: "20px", fontWeight: 700, color: "white" }}>
            {title}
          </h1>
        </div>

        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
    </header>
  );
}
