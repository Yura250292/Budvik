import { Suspense } from "react";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { FuelPage } from "./FuelPage";

/**
 * «Логістика → Паливо»: авто, норми й витрати на пальне.
 *
 * Обгортка серверна лише заради Suspense: сторінка читає useSearchParams.
 */
export default function Page() {
  return (
    <Suspense fallback={<CardSkeleton rows={3} title />}>
      <FuelPage />
    </Suspense>
  );
}
