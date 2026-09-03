"use client";

/**
 * Тимчасова обгортка планувальника.
 *
 * Сам планувальник переїхав у components/routes/RoutePlanner.tsx і стане
 * вкладкою «Карта» сторінки «Маршрути». Ця сторінка живе рівно доти, доки
 * вкладку не зібрано, — потім лишиться редиректом заради закладок.
 */

import { Suspense } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import RoutePlanner from "@/components/routes/RoutePlanner";

function RoutePlannerPageContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!role) return null;
  if (!["ADMIN", "MANAGER"].includes(role)) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Доступ заборонено</h1>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
      <h1 className="text-xl font-bold text-bk sm:text-2xl">Планувальник маршрутів</h1>
      <RoutePlanner deliveryRouteId={searchParams.get("deliveryRouteId")} />
    </div>
  );
}

export default function RoutePlannerPage() {
  return (
    <Suspense>
      <RoutePlannerPageContent />
    </Suspense>
  );
}
