"use client";

import Link from "next/link";
import { useGateSession } from "@/lib/useGateSession";

/**
 * Роль-гейт кабінету торгового — один на всю секцію.
 *
 * Саме тут, а не в middleware: middleware для /sales/** вимагає лише
 * токен (див. src/middleware.ts), тож без цієї перевірки в кабінет зайшов
 * би будь-хто залогінений.
 *
 * До цього перевірка була скопійована в кожну сторінку окремо
 * (sales/page.tsx, clients, orders) у скороченому вигляді — без стану
 * "loading", через що на секунду блимало «Доступ заборонено» ще до того,
 * як сесія доїхала.
 *
 * ADMIN пускаємо навмисно — щоб керівник міг подивитися на екран очима
 * торгового, не заводячи собі окремий обліковий запис.
 *
 * MANAGER за замовчуванням не пускаємо: у секції лежать персональні
 * показники й заробіток конкретного торгового. Але окремі екрани — як
 * каталог — самі по собі нічого приватного не показують, тож вони
 * передають ширший `allow` своїм layout-ом.
 *
 * Сесію беремо не з useSession, а з useGateSession: голий useSession
 * оголошує «не увійшов» на будь-якій невдалій відповіді /api/auth/session,
 * і кабінет вигонив торгового з живою кукою — див. коментар у хуці.
 */

const ALLOWED = ["SALES", "ADMIN"];

export default function SalesGate({
  children,
  allow = ALLOWED,
}: {
  children: React.ReactNode;
  /** Ролі, яким відкрито цю частину секції. За замовчуванням SALES + ADMIN. */
  allow?: readonly string[];
}) {
  const { session, status } = useGateSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "";

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-g300 border-t-bk motion-reduce:animate-none" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-g600">Потрібен вхід.</p>
        <Link
          href="/login"
          className="mt-3 inline-block cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover"
        >
          Увійти
        </Link>
      </div>
    );
  }

  if (!allow.includes(role)) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm font-medium text-g600">Доступ заборонено</p>
        <p className="mt-1 text-xs text-g500">
          Кабінет доступний торговим представникам.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-4 py-2 text-sm font-medium text-g600 transition-colors hover:border-g300 hover:text-bk"
        >
          На головну
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
