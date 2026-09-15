import { Suspense } from "react";
import StaffMeetingsScreen from "@/components/cabinet/StaffMeetingsScreen";
import { SalesHeader } from "@/components/sales/SalesHeader";

/** Обгортка: шапка читає useSearchParams. */
export const dynamic = "force-dynamic";

export default function SalesMeetingsPage() {
  return (
    <Suspense fallback={null}>
      <StaffMeetingsScreen
        header={<SalesHeader title="Підсумки нарад" subtitle="Що вирішили й хто що робить" backTo="/sales/feed" />}
        base="/sales"
      />
    </Suspense>
  );
}
