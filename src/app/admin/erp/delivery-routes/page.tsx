import { redirect } from "next/navigation";
import { forwardQuery, type SearchParams } from "@/app/admin/logistics/forward-query";

/**
 * «Маршрути» стали «Доставкою» розділу «Логістика» (13.09.2026).
 *
 * Параметри переносяться всі (?tab=, ?day=, ?driver=, ?routeId=,
 * ?deliveryRouteId=, ?from=&to=): на них посилаються журнал листів,
 * менеджерські сторінки й повідомлення водіям, і кожне таке посилання має
 * відкрити той самий день і той самий маршрут.
 */
export default async function DeliveryRoutesRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  redirect(forwardQuery("/admin/logistics/delivery", await searchParams));
}
