"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronLeft, Sparkles } from "lucide-react";
import { useIsNativeApp } from "@/lib/useIsNativeApp";

/**
 * Темна шапка кабінету — спільна для торгового й водія.
 *
 * До неї кожен екран малював свою: /sales, /sales/clients і /sales/orders мали
 * три схожі, але різні за відступами блоки, а хаб водія — ще й зелену замість
 * чорної. Різні шапки читаються як різні застосунки, тому вона тут одна.
 *
 * Надзаголовок над назвою — не прикраса: він відповідає на «де я і що зараз»
 * («ВОДІЙ · 1 АКТИВНИЙ», «ЗМІНА З 08:54»). Саме тому шапка своя, а не системна.
 *
 * env(safe-area-inset-top) інлайном, а не класом .safe-area-top: тут потрібна
 * сума «свій відступ + виріз», а клас задає тільки виріз і затер би 12px.
 * У корені стоїть viewportFit: "cover" — контент розтягується під вирізи, і
 * відступ доводиться ставити руками.
 */
export function CabinetHeader({
  title,
  subtitle,
  backTo,
  right,
  sticky = true,
  hideAssistant = false,
}: {
  title: string;
  /** Дрібний рядок над заголовком: роль, стан, кількість. */
  subtitle?: string;
  /** Куди веде «назад». Немає — показуємо логотип (це головна секції). */
  backTo?: string;
  /** Слот під кнопки справа: дзвіночок, профіль. */
  right?: ReactNode;
  /**
   * Шапка липне до верху: профіль і «Назад» — єдиний вихід зі сторінки, а
   * списки клієнтів і документів довгі. Коли шапка їхала вгору разом зі
   * списком, повертатися доводилось прокруткою на початок.
   */
  sticky?: boolean;
  /**
   * Сховати кнопку помічника. Потрібно рівно на одному екрані — його
   * власному, де вона вела б сама в себе.
   */
  hideAssistant?: boolean;
}) {
  const isApp = useIsNativeApp();
  const pathname = usePathname();

  /**
   * Помічник лежить у своїй секції, а не в спільній.
   *
   * Адреса вирішує двоє: під /driver сторінка успадковує гейт водія і
   * нижню панель водія, під /sales — торгового. Одна спільна сторінка
   * лишила б людину без навігації назад, а це на телефоні глухий кут.
   */
  const assistantHref = pathname.startsWith("/driver") ? "/driver/assistant" : "/sales/assistant";
  const showAssistant = !hideAssistant && !pathname.endsWith("/assistant");

  return (
    <header
      className={sticky ? "sticky top-0 z-40" : "relative"}
      style={{
        background: "linear-gradient(135deg, #0A0A0A 0%, #1C1C1C 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Золота волосинка по верху — єдина мітка бренду на робочих екранах */}
      <div
        style={{
          height: "2px",
          background: "linear-gradient(to right, transparent, #FFD600, transparent)",
        }}
      />

      <div
        className="mx-auto flex max-w-lg items-center gap-3 px-4"
        style={{
          paddingTop: "calc(10px + env(safe-area-inset-top, 0px))",
          paddingBottom: "14px",
        }}
      >
        {backTo ? (
          <Link
            href={backTo}
            aria-label="Назад"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <ChevronLeft size={22} color="#FFFFFF" />
          </Link>
        ) : isApp ? (
          // У застосунку логотип — просто знак, а не двері у вітрину магазину:
          // звідти назад у кабінет нема чим повернутись, бо браузерної
          // адресної стрічки в WebView немає.
          <span className="shrink-0">
            <Image src="/logo-gold.png" alt="Budvik" width={36} height={36} className="h-9 w-auto" />
          </span>
        ) : (
          <Link href="/" aria-label="Перейти на сайт Budvik" className="shrink-0">
            <Image src="/logo-gold.png" alt="Budvik" width={36} height={36} className="h-9 w-auto" />
          </Link>
        )}

        <div className="min-w-0 flex-1">
          {!!subtitle && (
            <p
              className="truncate uppercase"
              style={{ fontSize: "11px", fontWeight: 500, color: "rgba(255,255,255,0.45)", letterSpacing: "0.6px" }}
            >
              {subtitle}
            </p>
          )}
          <h1 className="truncate" style={{ fontSize: "20px", fontWeight: 700, color: "white" }}>
            {title}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/*
            Помічник у шапці, а не плиткою на головній: питання «скільки він
            винен» виникає посеред екрана клієнтів або маршруту, а не там,
            звідки день починався. Шапка — єдине місце, спільне для всіх
            екранів обох кабінетів.
          */}
          {showAssistant && (
            <Link
              href={assistantHref}
              aria-label="Помічник"
              // Без плашки й трохи менша за сусідів: на головній торгового
              // праворуч уже стоять дзвінок, вихід і аватар, і четверта
              // кнопка з фоном з'їдала заголовок до трьох літер.
              className="flex h-10 w-9 items-center justify-center"
            >
              <Sparkles size={20} color="#FFD600" />
            </Link>
          )}
          {right}
        </div>
      </div>
    </header>
  );
}
