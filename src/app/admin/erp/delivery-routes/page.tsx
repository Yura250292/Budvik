import { Suspense } from "react";
import RoutesShell from "./components/RoutesShell";
import { CardSkeleton } from "@/components/ui/Skeleton";

/**
 * «Маршрути» — один екран замість трьох.
 *
 * До 03.09.2026 логістика жила в трьох місцях: маршрути доставки списком за
 * весь час, планувальник на карті окремим пунктом меню й журнал листів 1С у
 * розділі водіїв. Тепер це вкладки День · Журнал · Карта, а робочий шлях
 * читається зверху вниз: узяти лист 1С або скласти маршрут по клієнтах →
 * прокласти порядок → передати водієві → надіслати посилання.
 *
 * Обгортка серверна лише заради Suspense: усе всередині — клієнтське, бо
 * стан живе в querystring (useSearchParams вимагає межі Suspense).
 */
export default function DeliveryRoutesPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <CardSkeleton rows={3} title />
        </div>
      }
    >
      <RoutesShell />
    </Suspense>
  );
}
