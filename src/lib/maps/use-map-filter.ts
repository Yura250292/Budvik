"use client";

/**
 * Які стани клієнтів сховані на карті водія.
 *
 * «Нові» вимкнені за замовчуванням, і це не примха: їх 2678 із 3094. Синя
 * маса накриває карту так, що серед неї не видно ні маршруту, ні тих, до
 * кого водій справді їздить. Кому треба — вмикає одним тапом.
 *
 * Вибір запам'ятовується на пристрої: перемикати фільтр щоразу, відкриваючи
 * карту в машині, — це саме той дрібний обов'язок, через який люди перестають
 * користуватися функцією.
 *
 * Через useSyncExternalStore, а не useState + useEffect: сторінка
 * рендериться і на сервері, де localStorage немає. Читання «в ефекті» дало б
 * зайвий перемальовок карти одразу після відкриття, а читання в рендері —
 * розбіжність між сервером і браузером.
 */

import { useCallback, useSyncExternalStore } from "react";

const KEY = "budvik.mapHidden";

/** Що ховаємо, поки водій не вибрав інакше. */
const DEFAULT_HIDDEN = ["NEW"];

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * Знімок — РЯДОК, а не Set.
 *
 * useSyncExternalStore порівнює знімки за значенням: новий Set на кожному
 * читанні означав би нескінченний цикл перемальовок.
 */
function read(): string {
  try {
    const raw = localStorage.getItem(KEY);
    // Порожній рядок — це збережений вибір «показувати все», і він не те
    // саме, що відсутній запис: там діє замовчування.
    return raw === null ? DEFAULT_HIDDEN.join(",") : raw;
  } catch {
    return DEFAULT_HIDDEN.join(",");
  }
}

function serverSnapshot(): string {
  return DEFAULT_HIDDEN.join(",");
}

export function useHiddenStates(): [Set<string>, (next: Set<string>) => void] {
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);

  const hidden = new Set(raw.split(",").filter(Boolean));

  const setHidden = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(KEY, [...next].join(","));
    } catch {
      // Не збереглося — вибір діє до кінця сеансу, і цього досить.
    }
    listeners.forEach((l) => l());
  }, []);

  return [hidden, setHidden];
}
