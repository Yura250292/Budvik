/**
 * Сторінка помічника.
 *
 * Тонка обгортка: усе живе в клієнтському екрані, а тут — Suspense, без
 * якого useSearchParams у Next 16 валить білд усього маршруту.
 */

import { Suspense } from "react";
import AssistantEntry from "@/components/sales/assistant/AssistantEntry";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <AssistantEntry section="sales" />
    </Suspense>
  );
}
