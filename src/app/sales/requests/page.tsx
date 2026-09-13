import { Suspense } from "react";
import RequestsScreen from "./RequestsScreen";

/** Обгортка: CabinetHeader і форма читають useSearchParams. */
export const dynamic = "force-dynamic";

export default function RequestsPage() {
  return (
    <Suspense fallback={null}>
      <RequestsScreen />
    </Suspense>
  );
}
