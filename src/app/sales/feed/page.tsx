import { Suspense } from "react";
import SalesFeedScreen from "./SalesFeedScreen";

/** Обгортка: CabinetHeader читає useSearchParams, без Suspense Next 16 валить білд. */
export const dynamic = "force-dynamic";

export default function SalesFeedPage() {
  return (
    <Suspense fallback={null}>
      <SalesFeedScreen />
    </Suspense>
  );
}
