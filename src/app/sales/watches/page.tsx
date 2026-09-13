import { Suspense } from "react";
import WatchesScreen from "./WatchesScreen";

/** Обгортка: CabinetHeader читає useSearchParams, без Suspense Next 16 валить білд. */
export const dynamic = "force-dynamic";

export default function WatchesPage() {
  return (
    <Suspense fallback={null}>
      <WatchesScreen />
    </Suspense>
  );
}
