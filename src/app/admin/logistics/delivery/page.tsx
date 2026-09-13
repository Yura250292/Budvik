import { Suspense } from "react";
import RoutesShell from "./components/RoutesShell";
import { CardSkeleton } from "@/components/ui/Skeleton";

/**
 * «Доставка» — маршрути водіїв: День · Журнал · Карта.
 *
 * До 03.09.2026 логістика доставки жила в трьох місцях: маршрути списком за
 * весь час, планувальник на карті окремим пунктом меню й журнал листів 1С у
 * розділі водіїв. Тепер це вкладки одного екрана, а робочий шлях читається
 * зверху вниз: узяти лист 1С або скласти маршрут по клієнтах → прокласти
 * порядок → передати водієві → надіслати посилання. З 13.09.2026 екран живе в
 * розділі «Логістика» (стара адреса /admin/erp/delivery-routes — редірект).
 *
 * Обгортка серверна лише заради Suspense: усе всередині — клієнтське, бо
 * стан живе в querystring (useSearchParams вимагає межі Suspense).
 */
export default function DeliveryPage() {
  return (
    <Suspense fallback={<CardSkeleton rows={3} title />}>
      <RoutesShell />
    </Suspense>
  );
}
