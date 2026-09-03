"use client";

import Link from "next/link";
import { useGateSession } from "@/lib/useGateSession";

/**
 * Роль-гейт кабінету водія — один на всю секцію.
 *
 * Саме тут, а не в middleware: middleware для /driver/** пускає ADMIN,
 * MANAGER і DRIVER, але не тримає стану завантаження сесії, через що на
 * секунду блимав би чужий екран.
 *
 * ADMIN і MANAGER пускаємо навмисно — щоб керівник міг подивитися на
 * маршрут очима водія, не заводячи собі окремий обліковий запис. Той
 * самий підхід, що в SalesGate.
 *
 * Сесію беремо з useGateSession, а не з голого useSession: той оголошує
 * «не увійшов» на будь-якій невдалій відповіді /api/auth/session, і планшет
 * у машині показував би вхід людині з живою кукою — див. коментар у хуці.
 * Тут це болючіше, ніж у торгового: сам трек не спиниться (роль лежить
 * локально, пише фонове завдання), але водій, побачивши екран входу,
 * натисне «Вийти» — а це вже logoutAndStop, і день обірветься.
 */

const ALLOWED = ["DRIVER", "ADMIN", "MANAGER"];

export default function DriverGate({ children }: { children: React.ReactNode }) {
  const { session, status } = useGateSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "";

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "#F3F4F6" }}>
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
        <p style={{ fontSize: "14px", color: "#4B5563" }}>Потрібен вхід.</p>
        <Link
          href="/login"
          className="mt-3 inline-block cursor-pointer rounded-xl px-4 py-2.5 transition-colors"
          style={{ background: "#0A0A0A", color: "#fff", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}
        >
          Увійти
        </Link>
      </div>
    );
  }

  if (!ALLOWED.includes(role)) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p style={{ fontSize: "14px", fontWeight: 500, color: "#4B5563" }}>Доступ заборонено</p>
        <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "4px" }}>
          Кабінет доступний водіям.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block cursor-pointer rounded-xl px-4 py-2.5 transition-colors"
          style={{ border: "1px solid #E5E7EB", color: "#4B5563", fontSize: "14px", fontWeight: 500, textDecoration: "none" }}
        >
          На головну
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
