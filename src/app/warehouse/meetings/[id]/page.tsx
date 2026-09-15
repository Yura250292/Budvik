import { Suspense } from "react";
import StaffMeetingScreen from "@/components/cabinet/StaffMeetingScreen";
import { CabinetHeader } from "@/components/cabinet/Header";

/** Обгортка: шапка читає useSearchParams. */
export const dynamic = "force-dynamic";

export default async function WarehouseMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <StaffMeetingScreen
        id={id}
        header={<CabinetHeader title="Нарада" subtitle="Підсумок від керівника" backTo="/warehouse/meetings" />}
        base="/warehouse"
      />
    </Suspense>
  );
}
