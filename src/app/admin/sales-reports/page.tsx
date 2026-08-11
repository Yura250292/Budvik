import { redirect } from "next/navigation";

/**
 * Звіти торгових переїхали в «Логістика → Поїздки» центру аналітики торгових.
 *
 * Редірект, а не видалення: посилання на /admin/sales-reports розійшлися по
 * закладках і чатах. API /api/admin/sales-reports лишається — саме він і
 * живить нову підвкладку.
 */
export default function SalesReportsRedirect() {
  redirect("/admin/sales-analytics?tab=logistics");
}
