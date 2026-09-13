"use client";

import Link from "next/link";
import { useState } from "react";
import { useIsNativeApp, type AppUpdate } from "@/lib/useIsNativeApp";

/**
 * Пункт «Оновити застосунок» у меню аватарки — один на всі кабінети.
 *
 * Видно ЗАВЖДИ, коли людина в застосунку. Раніше пункт з'являвся лише тоді,
 * коли сервер бачив новішу збірку, — і саме тоді, коли оновитися було
 * найпотрібніше, його не було: перевірка версії падала на поганому зв'язку,
 * оновлення повітрям змінювало номер, який застосунок про себе називав
 * (12.09.2026 так сховало пункт у всіх), а в меню керівника пункту не було
 * взагалі. 13.09.2026 власник попросив, щоб оновитися з аватарки могли всі.
 *
 * Два стани, і вони навмисно поводяться по-різному:
 *  • є новіша збірка — один дотик, одразу качаємо;
 *  • версія та сама або невідома — перший дотик лише питає «ще раз?». Файл
 *    важить понад сотню мегабайтів, а в меню тиснуть і випадково: без
 *    підтвердження торговий у полі витрачав би мобільний трафік дарма.
 */

function UpdateIcon() {
  return (
    <svg className="h-4.5 w-4.5 shrink-0 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

/** Жовта крапка — той самий сигнал «треба глянути», що й на вкладці «Зміна». */
function UpdateDot() {
  return <span aria-hidden className="ml-auto h-2 w-2 shrink-0 rounded-full bg-[#FFD600]" />;
}

function Label({ title, hint }: { title: string; hint: string | null }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-[14px] font-semibold text-bk">{title}</span>
      {!!hint && <span className="truncate text-[12px] font-normal text-g500">{hint}</span>}
    </span>
  );
}

export function AppUpdateMenuItem({
  update,
  appPageHref,
  onClose,
  padX = "px-4",
}: {
  update: AppUpdate;
  /**
   * Куди вести збірку, яка не вміє завантажити файл сама (старий трекер без
   * `downloadUpdate` у мості). Немає — пункт такій збірці не показуємо: кнопка,
   * що нічого не робить, гірша за її відсутність.
   */
  appPageHref?: string;
  onClose: () => void;
  /** Бічний відступ — щоб пункт стояв рівно з рештою меню. */
  padX?: string;
}) {
  const isApp = useIsNativeApp();
  const [confirm, setConfirm] = useState(false);

  // У браузері оновлювати нічого: там сторінка встановлення, а не пункт меню.
  if (!isApp) return null;

  const row = `flex min-h-11 w-full items-center gap-2.5 border-t border-g200 ${padX} py-2 text-left transition-colors hover:bg-g50 active:bg-g100`;
  const size = update.sizeBytes ? `${Math.round(update.sizeBytes / 1024 / 1024)} МБ` : null;

  if (!update.canSelfUpdate) {
    if (!appPageHref) return null;
    return (
      <Link href={appPageHref} role="menuitem" className={row} onClick={onClose}>
        <UpdateIcon />
        <Label
          title="Оновити застосунок"
          hint={update.available ? "Доступна нова версія — як оновити" : "Як оновити"}
        />
        {update.available && <UpdateDot />}
      </Link>
    );
  }

  if (update.available) {
    return (
      <button
        type="button"
        role="menuitem"
        className={row}
        onClick={() => {
          onClose();
          update.start();
        }}
      >
        <UpdateIcon />
        <Label
          title="Оновити застосунок"
          hint={[update.latestName ? `Нова версія ${update.latestName}` : "Доступна нова версія", size]
            .filter(Boolean)
            .join(" · ")}
        />
        <UpdateDot />
      </button>
    );
  }

  const hint = confirm
    ? ["Натисніть ще раз, щоб завантажити", size].filter(Boolean).join(" · ")
    : !update.checked
      ? "Перевіряю версію…"
      : update.latestName
        ? `У вас остання версія ${update.latestName}`
        : "Не вдалося перевірити версію";

  return (
    <button
      type="button"
      role="menuitem"
      className={`${row}${confirm ? " bg-[#FFFBEB]" : ""}`}
      onClick={() => {
        if (!confirm) {
          setConfirm(true);
          return;
        }
        onClose();
        update.start();
      }}
    >
      <UpdateIcon />
      <Label title={confirm ? "Завантажити застосунок ще раз?" : "Оновити застосунок"} hint={hint} />
    </button>
  );
}
