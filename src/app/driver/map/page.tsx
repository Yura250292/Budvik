import { Suspense } from "react";
import DriverMapScreen from "./MapScreen";

/**
 * Карта водія.
 *
 * Suspense обов'язковий: екран читає відкритий маршрут із адреси
 * (useSearchParams), а без межі очікування Next вимагає рендерити
 * динамічно всю сторінку.
 */
export default function DriverMapPage() {
  return (
    <Suspense fallback={<div style={{ height: "100vh", background: "#E5E7EB" }} />}>
      <DriverMapScreen />
    </Suspense>
  );
}
