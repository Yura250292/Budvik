import { redirect } from "next/navigation";

/**
 * Звіти торгових (поїздки Telegram-бота) — «Логістика → Архів поїздок».
 *
 * Редірект, а не видалення: посилання на /admin/sales-reports розійшлися по
 * закладках і чатах. API /api/admin/sales-reports лишається — саме він і
 * живить архів.
 */
export default function SalesReportsRedirect() {
  redirect("/admin/logistics/trips");
}
