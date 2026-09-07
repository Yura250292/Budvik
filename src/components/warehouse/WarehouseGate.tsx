"use client";

import Link from "next/link";
import { useGateSession } from "@/lib/useGateSession";

/**
 * Роль-гейт кабінету складу — один на всю секцію.
 *
 * Дзеркало DriverGate, і з тієї ж причини: middleware пускає ADMIN, MANAGER і
 * WAREHOUSE, але стану завантаження сесії не тримає, тож без цього на секунду
 * блимав би чужий екран.
 *
 * Сесію беремо з useGateSession, а не з голого useSession: той оголошує «не
 * увійшов» на будь-якій невдалій відповіді /api/auth/session, і планшет на
 * складі показував би форму входу людині з живою кукою — а вона, побачивши
 * її, натисне «Вийти» посеред зміни.
 */

const ALLOWED = ["WAREHOUSE", "ADMIN", "MANAGER"];

export default function WarehouseGate({ children }: { children: React.ReactNode }) {
  const { session, status } = useGateSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "";

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cab-bg">
        <div
          className="h-6 w-6 animate-spin rounded-full motion-reduce:animate-none"
          style={{ border: "2px solid #E5E7EB", borderTopColor: "#0A0A0A" }}
        />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-cab-t2">Потрібен вхід.</p>
        <Link
          href="/login"
          className="mt-3 inline-block rounded-xl bg-bk px-4 py-2.5 text-sm font-semibold text-white"
        >
          Увійти
        </Link>
      </div>
    );
  }

  if (!ALLOWED.includes(role)) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm font-medium text-cab-t2">Доступ заборонено</p>
        <p className="mt-1 text-xs text-cab-t3">Кабінет доступний складовщикам.</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block rounded-xl border border-cab-line px-4 py-2.5 text-sm font-medium text-cab-t2"
        >
          На головну
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
