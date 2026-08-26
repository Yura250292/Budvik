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
 * Версія застосунку з User-Agent: «… BudvikApp/1.0».
 *
 * Потрібна для збірок, що вийшли до появи оновлень через меню: моста
 * appVersionCode у них немає, а мітку в UA застосунок ставив завжди.
 * Без цього запасного шляху перше оновлення довелося б ставити руками
 * через браузер — тобто саме ті планшети, які найбільше його потребують,
 * кнопки й не побачили б.
 */
function versionNameFromUserAgent(): string | null {
  if (typeof navigator === "undefined") return null;
  const m = navigator.userAgent.match(/BudvikApp\/([\d.]+)/);
  return m ? m[1] : null;
}

/**
 * Порівнює версії виду «1.10» — почастинно, як числа.
 *
 * Рядкове порівняння тут бреше: «1.10» < «1.9» за алфавітом, хоча
 * насправді новіше.
 */
function isNewer(server: string, installed: string): boolean {
  const a = server.split(".").map(Number);
  const b = installed.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Чи є на сервері свіжіша збірка застосунку.
 *
 * Питаємо лише всередині застосунку: у браузері оновлювати нічого, а
 * зайвий запит на кожне відкриття меню профілю нікому не потрібен.
 *
 * Два способи дізнатися свою версію. Основний — міст (versionCode,
 * ціле число, за яким і Android вирішує, що новіше). Запасний — мітка
 * в User-Agent, бо старі збірки моста не мають, а оновитися їм треба
 * найбільше.
 *
 * `viaBridge` каже, чи вміє застосунок завантажити оновлення сам. Якщо
 * ні — кнопка веде на сторінку /sales/app, звідки файл качається
 * браузером: гірше, ніж один дотик, але незрівнянно краще, ніж
 * пояснювати кожному торговому адресу сайту голосом.
 *
 * Мовчазний збій навмисний: не змогли спитати сервер або відповідь
 * дивна — просто не показуємо пункт. Кнопка «оновити», яка не працює,
 * гірша за її відсутність.
 */
/**
 * Перша збірка, підписана постійним ключем.
 *
 * До неї кожен APK підписувався ефемерним ключем, який CI-раннер
 * генерував собі сам, — і кожна нова збірка була для Android «чужим
 * пакетом». Оновлення поверх такої не стає: система каже «пакет
 * конфліктує», і єдиний вихід — знести застосунок і поставити наново.
 *
 * Число тут потрібне, щоб не гнати на це ВСІХ. Оновлення з 3 на 4 і далі
 * ставиться поверх звичайно, а зайве знесення коштувало б ненадісланого
 * буфера точок і повторного входу на кожному планшеті.
 */
const FIRST_PERMANENT_KEY_BUILD = 3;

export function useAppUpdate(): {
  available: boolean;
  viaBridge: boolean;
  /**
   * Встановлена збірка старша за перехід на постійний ключ — оновлення
   * впреться в «пакет конфліктує», і його треба ставити з нуля.
   */
  signatureChange: boolean;
  start: () => void;
} {
  const [available, setAvailable] = useState(false);
  const [viaBridge, setViaBridge] = useState(false);
  const [signatureChange, setSignatureChange] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = window.BudvikApp;
    // Не застосунок — оновлювати нічого.
    if (!bridge) return;

    const canSelfUpdate = !!bridge.appVersionCode && !!bridge.downloadUpdate;
    const installedCode = canSelfUpdate ? bridge.appVersionCode!() : null;
    const installedName = versionNameFromUserAgent();

    // Ні коду, ні мітки — порівнювати нема з чим.
    if (installedCode === null && !installedName) return;

    let cancelled = false;

    fetch("/api/app/version", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;

        const newer =
          installedCode !== null
            ? Number.isFinite(Number(data.versionCode)) &&
              Number(data.versionCode) > installedCode
            : typeof data.versionName === "string" &&
              !!installedName &&
              isNewer(data.versionName, installedName);

        if (newer) {
          setAvailable(true);
          setViaBridge(canSelfUpdate);
          setSignatureChange(
            installedCode !== null && installedCode < FIRST_PERMANENT_KEY_BUILD
          );
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    available,
    viaBridge,
    signatureChange,
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
