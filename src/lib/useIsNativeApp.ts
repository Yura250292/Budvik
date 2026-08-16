"use client";

/**
 * Чи відкрито сторінку всередині нативного застосунку.
 *
 * Застосунок показує кабінет у WebView і додає в сторінку міст
 * `window.BudvikApp` (addJavascriptInterface). Наявність цього об'єкта —
 * найнадійніша ознака: на відміну від кукі `budvik_app`, вона не
 * протухає, не чиститься разом із сесією і не переїжджає у звичайний
 * браузер, якщо торговий колись відкриє сайт з телефона.
 *
 * Кукі лишається запасним каналом для серверних компонентів, яким
 * об'єкт вікна недоступний (див. /api/device/session).
 *
 * Навіщо useEffect, а не ініціалізатор useState: на сервері моста немає,
 * і якщо перший рендер на клієнті одразу поверне true, розмітка розійдеться
 * з серверною — React лається на hydration mismatch. Тож перший кадр
 * завжди «не застосунок», а різницю домальовуємо після монтування.
 */

import { useEffect, useState } from "react";

/** Міст, який нативний застосунок інжектить у кожну сторінку кабінету. */
export type BudvikAppBridge = {
  /** Відкрити нативний екран зміни (одометр, історія, вихід). */
  openShift(): void;
  /** Повний вихід: зупинити трек, стерти токен пристрою і кукі. */
  logout(): void;
  /** Стан зміни JSON-рядком: {"open":boolean,"pending":number}. */
  shiftStateJson(): string;
  /** versionName застосунку — для діагностики. */
  appVersion(): string;
  /**
   * Номер збірки. Порівнюється з /api/app/version.
   *
   * Може бути відсутнім: у застосунках, встановлених до появи
   * оновлення через меню, моста цього методу ще немає.
   */
  appVersionCode?(): number;
  /** Завантажити нову збірку і відкрити встановлювач. */
  downloadUpdate?(): void;
};

declare global {
  interface Window {
    BudvikApp?: BudvikAppBridge;
  }
}

export function useIsNativeApp(): boolean {
  const [isApp, setIsApp] = useState(false);

  useEffect(() => {
    setIsApp(typeof window !== "undefined" && !!window.BudvikApp);
  }, []);

  return isApp;
}

/**
 * Чи є на сервері свіжіша збірка застосунку.
 *
 * Питаємо лише всередині застосунку: у браузері оновлювати нічого, а
 * зайвий запит на кожне відкриття меню профілю нікому не потрібен.
 *
 * Мовчазний збій навмисний. Не змогли спитати сервер, старий міст без
 * appVersionCode, дивна відповідь — просто не показуємо пункт. Кнопка
 * «оновити», яка не працює, гірша за її відсутність: торговий тиснув би
 * її щоразу, коли щось іде не так, вважаючи це ліками.
 */
export function useAppUpdate(): { available: boolean; start: () => void } {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.BudvikApp : undefined;
    if (!bridge?.appVersionCode || !bridge.downloadUpdate) return;

    let cancelled = false;
    const installed = bridge.appVersionCode();

    fetch("/api/app/version", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const server = Number(data.versionCode);
        if (Number.isFinite(server) && server > installed) setAvailable(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    available,
    start: () => window.BudvikApp?.downloadUpdate?.(),
  };
}

/**
 * Стан зміни з моста — для бейджа на вкладці «Зміна».
 *
 * Синхронний виклик у натив без мережі: застосунок віддає те, що вже
 * лежить у Storage. Помилку гасимо мовчки — бейдж не та річ, заради
 * якої варто ламати навігацію.
 */
export function readShiftState(): { open: boolean; pending: number } | null {
  if (typeof window === "undefined" || !window.BudvikApp) return null;
  try {
    const parsed = JSON.parse(window.BudvikApp.shiftStateJson());
    return {
      open: !!parsed?.open,
      pending: typeof parsed?.pending === "number" ? parsed.pending : 0,
    };
  } catch {
    return null;
  }
}
