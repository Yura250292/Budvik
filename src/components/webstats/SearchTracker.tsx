"use client";

/**
 * Позначка «шукали ось це і знайшли стільки». Нічого не рендерить.
 *
 * Стоїть на сторінці каталогу, а не в полях пошуку: усі три поля
 * (шапка, мобільний оверлей, AI-пошук) ведуть на /catalog?search=, тож
 * одна точка покриває їх усі й нічого не треба правити в компонентах.
 *
 * Головна цінність — value: кількість знайдених товарів. Нуль означає
 * запит, на якому покупець пішов ні з чим; саме такі рядки і є списком
 * «що додати в каталог».
 */

import { useEffect } from "react";
import { track, markOnce } from "@/lib/webstats/client";

export default function SearchTracker({ query, total }: { query: string; total: number }) {
  useEffect(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return;
    // Один запит рахуємо раз на сесію: перегортання сторінок видачі й
    // повернення «назад» — це той самий пошук.
    if (!markOnce(`q_${normalized}`)) return;
    track("search", { query: normalized, value: total, path: "/catalog" });
  }, [query, total]);

  return null;
}
