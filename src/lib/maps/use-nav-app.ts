"use client";

/**
 * Чим водій їде: Google Maps чи Waze.
 *
 * Через useSyncExternalStore, а не через useState + useEffect, і причина
 * не в стилі. Сторінка рендериться і на сервері, де localStorage немає:
 * читання «в ефекті» дає зайвий перемальовок, а читання прямо в рендері —
 * розбіжність між тим, що прийшло з сервера («Google»), і тим, що бачить
 * браузер («Waze»). Хук віддає серверу свій знімок, а браузеру свій, і
 * React сам робить перехід без миготіння.
 *
 * Значення спільне для всіх екранів водія: обрав Waze у «Моєму дні» —
 * попап на карті теж веде в Waze. Тому підписка глобальна: перемикач на
 * одному екрані має оновити інший, відкритий поруч.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { NavApp } from "./google-links";

const KEY = "budvik.navApp";
const BATCH_KEY = "budvik.navBatch";

/**
 * Скільки наступних точок заряджаємо в навігатор за раз.
 *
 * Одна — це «веди мене туди»; три-пʼять — це вже погляд на найближчу
 * годину: видно, в який бік день і чи не доведеться вертатися. Більше не
 * пропонуємо свідомо: посилання Google бере девʼять проміжних точок, але
 * лише коли відкривається в застосунку Google Maps; у мобільному браузері
 * ліміт падає до трьох, і зайві точки зникають МОВЧКИ. Пʼять — межа, за
 * якою обіцянка перестає бути надійною.
 */
export type NavBatch = 1 | 3 | 5;
export const NAV_BATCHES: NavBatch[] = [1, 3, 5];

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Друга вкладка теж рахується: подія storage приходить лише «сусідам»,
  // тому власні зміни розсилаємо самі через notify().
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Примітив, а не обʼєкт: useSyncExternalStore порівнює знімки за значенням. */
function read(): NavApp {
  try {
    return localStorage.getItem(KEY) === "waze" ? "waze" : "google";
  } catch {
    // Приватний режим або заборонене сховище — Google як завжди.
    return "google";
  }
}

/** На сервері вибору не видно, і вгадувати його нема з чого. */
function serverSnapshot(): NavApp {
  return "google";
}

function readBatch(): NavBatch {
  try {
    const raw = Number(localStorage.getItem(BATCH_KEY));
    return raw === 3 || raw === 5 ? raw : 1;
  } catch {
    return 1;
  }
}

function serverBatch(): NavBatch {
  return 1;
}

/**
 * Скільки точок за раз. Окремо від навігатора, бо у Waze вибору немає:
 * він приймає рівно одну точку, і сам екран зводить кількість до однієї.
 */
export function useNavBatch(): [NavBatch, (n: NavBatch) => void] {
  const batch = useSyncExternalStore(subscribe, readBatch, serverBatch);

  const choose = useCallback((n: NavBatch) => {
    try {
      localStorage.setItem(BATCH_KEY, String(n));
    } catch {
      // Не збереглося — вибір діє до кінця сеансу, і цього досить.
    }
    notify();
  }, []);

  return [batch, choose];
}

export function useNavApp(): [NavApp, (app: NavApp) => void] {
  const navApp = useSyncExternalStore(subscribe, read, serverSnapshot);

  const choose = useCallback((app: NavApp) => {
    try {
      localStorage.setItem(KEY, app);
    } catch {
      // Не збереглося — але перемикач усе одно має спрацювати зараз.
    }
    notify();
  }, []);

  return [navApp, choose];
}
