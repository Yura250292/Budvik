import { redirect } from "next/navigation";
import { forwardQuery, type SearchParams } from "@/app/admin/logistics/forward-query";

/**
 * Планувальник — вкладка «Карта» в «Логістика → Доставка».
 *
 * Редірект, а не видалення: на цю адресу є закладки, і з неї відкривали
 * конкретний маршрут (?deliveryRouteId=) — параметр переноситься. Ведемо
 * одразу в кінцеве місце, без проміжного стрибка через /admin/erp/delivery-routes.
 */
export default async function RoutePlannerRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  redirect(forwardQuery("/admin/logistics/delivery", { tab: "map", ...sp, }, ["tab", "deliveryRouteId"]));
}
