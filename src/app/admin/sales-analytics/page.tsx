import { Suspense } from "react";
import { AnalyticsShell } from "./components/AnalyticsShell";

/**
 * Центр «Аналітика торгових»: продажі з 1С, поїздки з бота, КПІ,
 * маршрути й логістика в одному місці.
 *
 * Suspense обов'язковий: оболонка читає useSearchParams, а без межі
 * очікування Next вимагає рендерити всю сторінку динамічно.
 */
export default function SalesAnalyticsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-g300 border-t-bk motion-reduce:animate-none" />
        </div>
      }
    >
      <AnalyticsShell />
    </Suspense>
  );
}
