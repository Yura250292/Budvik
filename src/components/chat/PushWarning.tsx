"use client";

/**
 * «Сповіщення не приходять» — там, де це видно тому, кого стосується.
 *
 * Показуємо ЛИШЕ в застосунку: у браузері пуші й не обіцяні, і попередження
 * стало б шумом для офісу. Ознака — відсутність живого пристрою в базі, а не
 * дозвіл системи: дозвіл може бути на місці, а токен не видатись (саме так
 * ламався застосунок без ключів FCM — з вигляду все гаразд, а сповіщень
 * немає, і людина про це не дізнається ніколи).
 */

import Link from "next/link";
import { BellOff } from "lucide-react";
import { useIsNativeApp } from "@/lib/useIsNativeApp";
import { COPY } from "./copy";

export function PushWarning({ section }: { section: "sales" | "driver" | "warehouse" | "admin" }) {
  const isApp = useIsNativeApp();
  if (!isApp) return null;

  /**
   * Куди вести по оновлення — у кожного кабінету своє місце: у торгового й
   * водія окрема сторінка застосунку, у складу це картка в профілі, а в
   * адмінці такої сторінки немає взагалі (офіс сидить у браузері, і сюди він
   * не потрапить — попередження показується лише в застосунку).
   */
  const appHref =
    section === "sales" || section === "driver"
      ? `/${section}/app`
      : section === "warehouse"
        ? "/warehouse/profile"
        : null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warn-line bg-warn-bg p-3">
      <div className="flex items-center gap-2">
        <BellOff size={16} className="shrink-0 text-warn-fg" />
        <p className="flex-1 text-sm font-bold text-warn-fg">{COPY.pushOffTitle}</p>
      </div>
      <p className="text-[13px] leading-relaxed text-cab-t2">{COPY.pushOffBody}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          // Старі збірки методу не мають — тоді лишається порада текстом.
          onClick={() => window.BudvikApp?.openAppSettings?.()}
          className="h-11 rounded-xl border border-cab-line bg-white px-3 text-[13px] font-semibold text-bk"
        >
          {COPY.pushOffSettings}
        </button>
        {!!appHref && (
          <Link
            href={appHref}
            className="flex h-11 items-center rounded-xl bg-bk px-3 text-[13px] font-semibold text-white"
          >
            {COPY.pushOffUpdate}
          </Link>
        )}
      </div>
    </div>
  );
}
