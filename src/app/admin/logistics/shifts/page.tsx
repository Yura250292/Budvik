import { Suspense } from "react";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ShiftsPage } from "./ShiftsPage";

/**
 * «Логістика → Зміни»: одометр торгових і дні водіїв.
 *
 * Обгортка серверна лише заради Suspense: сторінка читає useSearchParams.
 */
export default function Page() {
  return (
    <Suspense fallback={<CardSkeleton rows={3} title />}>
      <ShiftsPage />
    </Suspense>
  );
}
