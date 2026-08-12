"use client";

/**
 * Стежить, чи не поїхав деплой під відкритою вкладкою.
 *
 * Планшет водія висить у тримачі годинами, а деплої їдуть кілька разів на
 * день. Після деплою стара сторінка не може довантажити свої чанки —
 * хеші імен змінились, — і кнопки тихо перестають працювати: натискаєш і
 * нічого не відбувається, без жодної помилки на екрані.
 *
 * Тому не перезавантажуємо мовчки: віддаємо прапорець нагору, і UI
 * показує смужку «вийшло оновлення». Автоматичний reload посеред дня міг
 * би стерти незбережену відмітку візиту.
 */

import { useEffect, useState } from "react";

/** Як часто питаємо версію. Раз на 5 хв — деплої не частіші. */
const CHECK_MS = 5 * 60_000;

export function useBuildVersion(): { stale: boolean; reload: () => void } {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    let known: string | null = null;

    const check = async () => {
      try {
        // no-store: інакше відповідь сама осяде в кеші й ніколи не зміниться
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = await res.json();
        if (!alive || typeof version !== "string") return;
        if (known === null) {
          known = version;
          return;
        }
        if (version !== known) setStale(true);
      } catch {
        // Немає звʼязку — не наша турбота, трек і так буферизується
      }
    };

    void check();
    const id = window.setInterval(check, CHECK_MS);
    // Повернення з фону — найімовірніший момент, коли деплой уже проїхав
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { stale, reload: () => window.location.reload() };
}
