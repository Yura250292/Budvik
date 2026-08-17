import { Suspense } from "react";
import { AiAnalysisShell } from "./components/AiAnalysisShell";

export const metadata = { title: "AI аналіз фірми" };

/**
 * Тонка серверна обгортка: шелл читає ?tab= і ?from=&to= через
 * useSearchParams, а той у App Router вимагає Suspense вище по дереву.
 */
export default function AiAnalysisPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-g500">Завантаження…</div>}>
      <AiAnalysisShell />
    </Suspense>
  );
}
