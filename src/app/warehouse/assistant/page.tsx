/**
 * Помічник у кабінеті складу.
 *
 * Той самий екран, що в торгового й водія, лише під /warehouse: звідси він
 * успадковує гейт складу й нижнє меню складу, тож «назад» веде на зміну, а не
 * в чужу секцію. Що саме помічник уміє, вирішує роль на сервері, а не адреса
 * сторінки.
 */

import { Suspense } from "react";
import AssistantEntry from "@/components/sales/assistant/AssistantEntry";

export const dynamic = "force-dynamic";

export default function WarehouseAssistantPage() {
  return (
    <Suspense fallback={null}>
      <AssistantEntry section="warehouse" />
    </Suspense>
  );
}
