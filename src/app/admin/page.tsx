"use client";

import { useSession } from "next-auth/react";
import DashboardGrid from "@/components/admin/dashboard/DashboardGrid";
import { isAdminRole } from "@/lib/admin-nav";

/**
 * Дашборд адмінки. Навігація по модулях переїхала в сайдбар шелла
 * (src/lib/admin-nav.ts), тут лишилися лише налаштовувані віджети.
 */
export default function AdminPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const userId = (session?.user as { id?: string } | undefined)?.id;

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
        <div className="grid auto-rows-[minmax(150px,auto)] grid-cols-2 gap-3 md:grid-cols-12">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="col-span-1 h-[150px] animate-pulse rounded-[var(--radius-card)] bg-g100 md:col-span-3" />
          ))}
        </div>
      </div>
    );
  }

  if (!isAdminRole(role)) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-bk">Доступ заборонено</h1>
        <p className="mt-2 text-sm text-g400">У вас немає доступу до панелі управління</p>
      </div>
    );
  }

  return <DashboardGrid userId={userId} role={role} />;
}
