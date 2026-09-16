import { Suspense } from "react";
import OutreachScreen from "./OutreachScreen";

/**
 * «Кому написати / подзвонити» — сюди веде пуш списку дзвінків об 11:00.
 *
 * Окрема адреса без параметрів: білий список тапів застосунку (CABINET_TARGET)
 * параметрів запиту не пропускає. Обгортка: CabinetHeader читає useSearchParams,
 * без Suspense Next 16 валить білд.
 */
export const dynamic = "force-dynamic";

export default function OutreachPage() {
  return (
    <Suspense fallback={null}>
      <OutreachScreen />
    </Suspense>
  );
}
