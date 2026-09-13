import { Suspense } from "react";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { DirectionsPage } from "./DirectionsPage";

/**
 * «Логістика → Напрямки торгових»: шаблони, розклад, мапа дня, зони.
 *
 * Обгортка серверна лише заради Suspense: сторінка читає useSearchParams.
 */
export default function Page() {
  return (
    <Suspense fallback={<CardSkeleton rows={3} title />}>
      <DirectionsPage />
    </Suspense>
  );
}
