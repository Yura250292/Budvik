import { Suspense } from "react";
import { DriversShell } from "./components/DriversShell";

/**
 * Розділ «Водії»: зарплата за листами, позиція на маршруті, налаштування.
 *
 * Suspense обов'язковий: оболонка читає useSearchParams, а без межі
 * очікування Next вимагає рендерити всю сторінку динамічно.
 */
export default function DriversPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-g300 border-t-bk motion-reduce:animate-none" />
        </div>
      }
    >
      <DriversShell />
    </Suspense>
  );
}
