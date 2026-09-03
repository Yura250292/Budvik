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
