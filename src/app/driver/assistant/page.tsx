/**
 * Помічник у кабінеті водія.
 *
 * Той самий екран, що в торгового, але під /driver: звідси він
 * успадковує гейт водія і нижню панель водія, тож «назад» веде на
 * маршрути, а не в чужу секцію. Що саме помічник уміє, вирішує роль на
 * сервері, а не адреса сторінки.
 */

import { Suspense } from "react";
import AssistantEntry from "@/components/sales/assistant/AssistantEntry";

export const dynamic = "force-dynamic";

export default function DriverAssistantPage() {
  return (
    <Suspense fallback={null}>
      <AssistantEntry section="driver" />
    </Suspense>
  );
}
