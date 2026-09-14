import { Suspense } from "react";
import StaffTasksScreen from "@/components/cabinet/StaffTasksScreen";
import { CabinetHeader } from "@/components/cabinet/Header";

/** Обгортка: шапка читає useSearchParams. */
export const dynamic = "force-dynamic";

export default function WarehouseTasksPage() {
  return (
    <Suspense fallback={null}>
      <StaffTasksScreen
        header={<CabinetHeader title="Задачі від офісу" subtitle="Доручення з нарад і від керівника" backTo="/warehouse" />}
        back="/warehouse/tasks"
      />
    </Suspense>
  );
}
