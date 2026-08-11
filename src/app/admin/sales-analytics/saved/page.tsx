import { SavedReports } from "./components/SavedReports";

/**
 * Архів АІ-звітів.
 *
 * Окремий маршрут, а не панель на вкладці: збережений звіт живе довше за
 * період, з якого його зробили, і посилання на нього має пересилатися.
 */
export default function SavedReportsPage() {
  return <SavedReports />;
}
