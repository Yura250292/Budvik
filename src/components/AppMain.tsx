"use client";

import { usePathname } from "next/navigation";

/**
 * Кореневий <main> вітрини.
 *
 * Розділи з власним повноекранним шеллом (адмінка, кабінет торгового,
 * планшет водія) самі задають собі висоту 100dvh і власний скрол-контейнер
 * усередині. Нижній падінг під таб-бар вітрини їм не потрібен: таб-бар там
 * не рендериться, а падінг додає до 100dvh ще 5rem — сторінка починає
 * скролитися тілом ПОВЕРХ внутрішнього скролу. Виглядає це як «сторінка не
 * гортається»: колесо то рухає внутрішній контейнер, то тіло, залежно від
 * того, над чим курсор.
 *
 * flex-1 лишаємо всюди: body — flex-колонка, і без нього шелл не отримав би
 * повної висоти.
 */
export default function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullscreenShell =
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/sales") ||
    pathname?.startsWith("/driver");

  return (
    <main className={`flex-1 min-h-0 ${fullscreenShell ? "" : "pb-20 md:pb-0"}`}>
      {children}
    </main>
  );
}
