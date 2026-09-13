"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronLeft, Sparkles } from "lucide-react";
import { useIsNativeApp } from "@/lib/useIsNativeApp";
import { ChatHeaderButton } from "@/components/chat/ChatHeaderButton";
import { CabinetProfileMenu } from "@/components/cabinet/ProfileMenu";

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
  hideChat = false,
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
  /** Сховати кнопку чату — на самому екрані чату вона вела б у себе. */
  hideChat?: boolean;
}) {
  const isApp = useIsNativeApp();
  const pathname = usePathname();
  const search = useSearchParams();

  /**
   * «Назад» веде туди, звідки прийшли, коли це сказано в адресі.
   *
   * Помічник відкриває картку клієнта посеред розмови, і кнопка «назад»
   * зі сторінки клієнта вела в список клієнтів — тобто розмова, у якій
   * торговий щойно розбирався, лишалася позаду без жодного шляху до неї.
   * Тепер посилання з помічника несуть `?back=`, а шапка його поважає.
   *
   * Приймаємо ЛИШЕ внутрішні шляхи кабінету: у параметрі адреси може
   * опинитися будь-що, і відкривати за ним чужий сайт з логотипом Budvik
   * ми не будемо.
   */
  const requested = search.get("back");
  const backHref =
    requested && /^\/(sales|driver|warehouse|admin)(\/|\?|$)/.test(requested) ? requested : backTo;

  /**
   * Помічник лежить у своїй секції, а не в спільній.
   *
   * Адреса вирішує двоє: під /driver сторінка успадковує гейт водія і
   * нижню панель водія, під /sales — торгового. Одна спільна сторінка
   * лишила б людину без навігації назад, а це на телефоні глухий кут.
   */
  const assistantHref = pathname.startsWith("/driver")
    ? "/driver/assistant"
    : pathname.startsWith("/warehouse")
      ? "/warehouse/assistant"
      : "/sales/assistant";
  const showAssistant = !hideAssistant && !pathname.endsWith("/assistant");

  /**
   * Чат живе у своїй секції з тієї самої причини, що й помічник: адреса
   * вирішує, чий гейт і чия нижня панель дістануться сторінці.
   */
  const chatHref = pathname.startsWith("/driver")
    ? "/driver/chat"
    : pathname.startsWith("/warehouse")
      ? "/warehouse/chat"
      : "/sales/chat";
  const showChat = !hideChat && !/\/chat(\/|$)/.test(pathname);

  /**
   * Аватарка з меню у водія й складу — її додає сама шапка.
   *
   * У торгового меню приходить через SalesHeader, а водій і склад малюють цю
   * шапку напряму на десятку сторінок: копія меню в кожній розійшлася б на
   * першій правці. Аватарки в них не було зовсім, і оновити застосунок з неї
   * вони не могли (13.09.2026). Сторінка профілю аватарку не дублює.
   */
  const profileMenu =
    pathname.startsWith("/driver") && !pathname.startsWith("/driver/profile") ? (
      <CabinetProfileMenu
        roleLabel="Водій"
        profileHref="/driver/profile"
        appPageHref="/driver/app"
        signOutTo="/login"
      />
    ) : pathname.startsWith("/warehouse") && !pathname.startsWith("/warehouse/profile") ? (
      <CabinetProfileMenu roleLabel="Складовщик" profileHref="/warehouse/profile" signOutTo="/login" />
    ) : null;

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
        {backHref ? (
          <Link
            href={backHref}
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
          {/* Чат перед помічником: у нього приходять люди, а не відповіді,
              і чекати їх довше. Обидві кнопки без плашки — на головній
              торгового праворуч уже стоять дзвінок, вихід і аватар. */}
          {showChat && <ChatHeaderButton href={chatHref} variant="dark" />}
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
          {profileMenu}
        </div>
      </div>
    </header>
  );
}
