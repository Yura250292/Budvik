import { Suspense } from "react";
import StaffTasksScreen from "@/components/cabinet/StaffTasksScreen";
import { SalesHeader } from "@/components/sales/SalesHeader";

/** Обгортка: шапка читає useSearchParams. */
export const dynamic = "force-dynamic";

export default function SalesTasksPage() {
  return (
    <Suspense fallback={null}>
      <StaffTasksScreen
        header={<SalesHeader title="Задачі від офісу" subtitle="Доручення з нарад і від керівника" backTo="/sales/feed" />}
        clientBase="/sales/clients/"
        back="/sales/tasks"
      />
    </Suspense>
  );
}
