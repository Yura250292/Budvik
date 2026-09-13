import { Suspense } from "react";
import PriceChangesScreen from "./PriceChangesScreen";

/** Обгортка: CabinetHeader читає useSearchParams, без Suspense Next 16 валить білд. */
export const dynamic = "force-dynamic";

export default function PriceChangesPage() {
  return (
    <Suspense fallback={null}>
      <PriceChangesScreen />
    </Suspense>
  );
}
