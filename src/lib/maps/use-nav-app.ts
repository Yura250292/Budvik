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
const AUTO_NEXT_KEY = "budvik.autoNext";

/**
 * Скільки наступних точок заряджаємо в навігатор за раз.
 *
 * Одна — це «веди мене туди»; три-пʼять — погляд на найближчу годину:
 * видно, в який бік день і чи не доведеться вертатися. Десять — увесь
 * ранок одним посиланням, і це стеля не наша, а Google: api=1 приймає
 * девʼять проміжних точок плюс призначення.
 *
 * Одинадцяту він відкидає МОВЧКИ — саме тому список тут скінченний, а не
 * поле для будь-якого числа.
 */
export type NavBatch = 1 | 3 | 5 | 10;
export const NAV_BATCHES: NavBatch[] = [1, 3, 5, 10];

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
    return NAV_BATCHES.includes(raw as NavBatch) ? (raw as NavBatch) : 1;
  } catch {
    return 1;
  }
}

function serverBatch(): NavBatch {
  return 1;
}

/**
 * Чи вести до наступної точки одразу після відмітки.
 *
 * Увімкнено за замовчуванням, і це головне: ліміт Google на девʼять
 * проміжних точок перестає що-небудь означати, коли наступну підставляє
 * сам застосунок. Водієві не треба повертатися в кабінет і тиснути
 * «Їхати» — він відмітив точку й далі просто їде.
 *
 * Вимикається одним дотиком: хто возить маршрут напамʼять, кому навігатор
 * потрібен лише зрідка, той не хоче, щоб Google відкривався сам.
 *
 * Порожнє сховище = увімкнено: єдине значення, яке ми пишемо для «ні», —
 * це рядок «0».
 */
function readAutoNext(): boolean {
  try {
    return localStorage.getItem(AUTO_NEXT_KEY) !== "0";
  } catch {
    return true;
  }
}

function serverAutoNext(): boolean {
  return true;
}

export function useAutoNext(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readAutoNext, serverAutoNext);

  const choose = useCallback((next: boolean) => {
    try {
      localStorage.setItem(AUTO_NEXT_KEY, next ? "1" : "0");
    } catch {
      // Не збереглося — вибір діє до кінця сеансу, і цього досить.
    }
    notify();
  }, []);

  return [on, choose];
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
