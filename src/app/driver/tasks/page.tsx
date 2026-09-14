import { Suspense } from "react";
import StaffTasksScreen from "@/components/cabinet/StaffTasksScreen";
import { CabinetHeader } from "@/components/cabinet/Header";

/** Обгортка: шапка читає useSearchParams. */
export const dynamic = "force-dynamic";

export default function DriverTasksPage() {
  return (
    <Suspense fallback={null}>
      <StaffTasksScreen
        header={<CabinetHeader title="Задачі від офісу" subtitle="Доручення з нарад і від керівника" backTo="/driver" />}
        back="/driver/tasks"
      />
    </Suspense>
  );
}
