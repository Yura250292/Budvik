import { redirect } from "next/navigation";

/**
 * Акаунти торгових переїхали у вкладку «Торгові» розділу «Користувачі».
 *
 * Сторінка була фактично дублем /admin/users: той самий /api/admin/users із
 * фільтром role === "SALES" на клієнті, а з унікального — лише «Зняти роль»,
 * що тепер покриває RoleSelect.
 *
 * Редірект, а не видалення: посилання розійшлися по закладках. Робочий
 * профіль торгового (регіони, клієнти, плани) лишається окремо —
 * /admin/sales-reps.
 */
export default function AdminSalesRedirect() {
  redirect("/admin/users?tab=sales");
}
