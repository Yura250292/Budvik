"use client";

import { useEffect, useState } from "react";

/**
 * Чи вистачає ширини на дві колонки — список ліворуч, розмова праворуч.
 *
 * Через matchMedia, а не через CSS, бо від відповіді залежить не лише
 * розкладка: на широкому екрані шапка має писати «Чат» і вести назад у
 * кабінет, а на телефоні — назву розмови й дорогу до списку. Класами
 * такого не зробиш, бо це текст і адреса, а не показ/приховування.
 *
 * Початкове значення false: сервер ширини не знає, і телефонна розкладка —
 * безпечніший перший кадр (на широкому екрані вона просто ширша).
 */
const QUERY = "(min-width: 768px)";

export function useIsWide(): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return wide;
}
