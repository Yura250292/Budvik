import { Suspense } from "react";
import ArrivalsScreen from "./ArrivalsScreen";

/** Обгортка: CabinetHeader читає useSearchParams, без Suspense Next 16 валить білд. */
export const dynamic = "force-dynamic";

export default function ArrivalsPage() {
  return (
    <Suspense fallback={null}>
      <ArrivalsScreen />
    </Suspense>
  );
}
