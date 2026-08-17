"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTabs } from "./TabsProvider";

/**
 * Обгортка вмісту вкладок.
 *
 * Свідомо НЕ намагається тримати неактивні вкладки змонтованими.
 *
 * Чому: в App Router `children` — це не сталий React-елемент, який можна
 * відкласти в кеш, а слот, який Next.js перезаповнює піддеревом ПОТОЧНОГО
 * маршруту. Збережений у ref «старий» children при наступному рендері
 * показує вже новий маршрут — перевірено в браузері: обидва слоти
 * рендерили однакову сторінку. Утримати справжній стан можна лише
 * паралельними роутерами (по одному на вкладку), а це вимагає власного
 * роутера поверх Next.js.
 *
 * Тому вкладки тут — швидке перемикання між відкритими розділами (як
 * закладки), а не заморожені вікна. Єдине, що переживає перемикання і
 * дешево дається, — позиція скролу: її запам'ятовуємо на вкладку й
 * відновлюємо при поверненні.
 */
export default function TabsViewport({ children }: { children: React.ReactNode }) {
  const { activeTabId, keepAlive } = useTabs();
  const pathname = usePathname() ?? "/admin";
  const scrollRef = useRef<Map<string, number>>(new Map());
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!keepAlive) return;
    // Саме [data-admin-scroll], а не "main": кореневий layout вітрини має
    // власний <main> вище по дереву, і querySelector("main") повертав його —
    // елемент без скролу взагалі. Позиція вкладок через це не відновлювалась.
    const scroller = document.querySelector("[data-admin-scroll]");
    if (!scroller) return;

    const key = `${activeTabId ?? ""}:${pathname}`;

    // Зберігаємо позицію вкладки, з якої щойно пішли.
    const prev = prevKeyRef.current;
    if (prev && prev !== key) scrollRef.current.set(prev, scroller.scrollTop);
    prevKeyRef.current = key;

    // Відновлюємо позицію після того, як сторінка встигла відмалюватися.
    const saved = scrollRef.current.get(key);
    if (saved) {
      const restore = () => scroller.scrollTo({ top: saved });
      requestAnimationFrame(restore);
      const t = setTimeout(restore, 220);
      return () => clearTimeout(t);
    }
  }, [activeTabId, pathname, keepAlive]);

  return <>{children}</>;
}
