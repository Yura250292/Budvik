import { Suspense } from "react";
import StaffMeetingsScreen from "@/components/cabinet/StaffMeetingsScreen";
import { CabinetHeader } from "@/components/cabinet/Header";

/** Обгортка: шапка читає useSearchParams. */
export const dynamic = "force-dynamic";

export default function DriverMeetingsPage() {
  return (
    <Suspense fallback={null}>
      <StaffMeetingsScreen
        header={<CabinetHeader title="Підсумки нарад" subtitle="Що вирішили й хто що робить" backTo="/driver" />}
        base="/driver"
      />
    </Suspense>
  );
}
