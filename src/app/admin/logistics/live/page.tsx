import { Suspense } from "react";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { LivePage } from "./LivePage";

/**
 * «Логістика → Рух на карті»: де зараз торгові й водії.
 *
 * Обгортка серверна лише заради Suspense: сторінка читає useSearchParams.
 */
export default function Page() {
  return (
    <Suspense fallback={<CardSkeleton rows={3} title />}>
      <LivePage />
    </Suspense>
  );
}
