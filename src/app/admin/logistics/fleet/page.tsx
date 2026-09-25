import { Suspense } from "react";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { FleetPage } from "./FleetPage";

/**
 * «Логістика → Автопарк»: машини, журнал обслуговування, ТО, амортизація.
 *
 * Обгортка серверна лише заради Suspense: сторінка читає useSearchParams.
 */
export default function Page() {
  return (
    <Suspense fallback={<CardSkeleton rows={4} title />}>
      <FleetPage />
    </Suspense>
  );
}
