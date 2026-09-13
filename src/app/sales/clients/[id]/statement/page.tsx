import { Suspense } from "react";
import StatementScreen from "./StatementScreen";

/** Обгортка: CabinetHeader читає useSearchParams, без Suspense Next 16 валить білд. */
export const dynamic = "force-dynamic";

export default function StatementPage() {
  return (
    <Suspense fallback={null}>
      <StatementScreen />
    </Suspense>
  );
}
