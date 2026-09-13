import { redirect } from "next/navigation";

/**
 * Маршрути менеджера злилися з адмінськими.
 *
 * Ця сторінка була дублем маршрутів доставки без пошуку клієнтів і без
 * уточнення пінів, у меню її не було, а вела на неї лише кнопка «назад»
 * зі старого планувальника. Тепер один екран для обох ролей —
 * «Логістика → Доставка»: middleware пускає під /admin і ADMIN, і MANAGER.
 */
export default function ManagerRoutesRedirect() {
  redirect("/admin/logistics/delivery");
}
