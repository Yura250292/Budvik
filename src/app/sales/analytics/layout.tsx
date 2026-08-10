"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

/**
 * Оболонка кабінету торгового.
 *
 * Роль-гейт саме тут, а не в middleware: middleware для /sales/** вимагає
 * лише токен (див. src/middleware.ts), тож без цієї перевірки в кабінет
 * зайшов би будь-хто залогінений.
 *
 * ADMIN пускаємо навмисно — щоб керівник міг подивитися на екран очима
 * торгового, не заводячи собі окремий обліковий запис.
 *
 * pb-28 обов'язковий: SalesBottomNav — fixed h-16 плюс safe-area, і без
 * відступу він накриває останню картку.
 */

const ALLOWED = ["SALES", "ADMIN"];

export default function SalesAnalyticsLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
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

  if (!ALLOWED.includes(role)) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm font-medium text-g600">Доступ заборонено</p>
        <p className="mt-1 text-xs text-g500">
          Кабінет показників доступний торговим представникам.
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

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-lg px-4 pt-4 pb-28">{children}</div>
    </div>
  );
}
