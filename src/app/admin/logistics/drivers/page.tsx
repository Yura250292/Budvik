import { Suspense } from "react";
import { DriversShell } from "./components/DriversShell";
import { CardSkeleton } from "@/components/ui/Skeleton";

/**
 * «Водії: зарплата і каса»: зарплата за листами, інкасація, прив'язка до 1С.
 *
 * Suspense обов'язковий: оболонка читає useSearchParams, а без межі
 * очікування Next вимагає рендерити всю сторінку динамічно.
 */
export default function DriversMoneyPage() {
  return (
    <Suspense fallback={<CardSkeleton rows={3} title />}>
      <DriversShell />
    </Suspense>
  );
}
