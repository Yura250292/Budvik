import { Suspense } from "react";
import StaffMeetingScreen from "@/components/cabinet/StaffMeetingScreen";
import { SalesHeader } from "@/components/sales/SalesHeader";

/** Обгортка: шапка читає useSearchParams. */
export const dynamic = "force-dynamic";

export default async function SalesMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <StaffMeetingScreen
        id={id}
        header={<SalesHeader title="Нарада" subtitle="Підсумок від керівника" backTo="/sales/meetings" />}
        base="/sales"
        clientBase="/sales/clients/"
      />
    </Suspense>
  );
}
