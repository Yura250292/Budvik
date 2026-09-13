import { Suspense } from "react";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { TripsPage } from "./TripsPage";

/**
 * «Логістика → Архів поїздок»: дані Telegram-бота до 14.08.2026.
 *
 * Обгортка серверна лише заради Suspense: сторінка читає useSearchParams.
 */
export default function Page() {
  return (
    <Suspense fallback={<CardSkeleton rows={3} title />}>
      <TripsPage />
    </Suspense>
  );
}
