import { redirect } from "next/navigation";

/**
 * Планувальник переїхав у вкладку «Карта» сторінки «Маршрути».
 *
 * Редірект, а не видалення: на цю адресу є закладки, і з неї відкривали
 * конкретний маршрут (?deliveryRouteId=) — параметр переноситься, щоб таке
 * посилання й далі приводило на ту саму карту з тим самим маршрутом.
 */
export default async function RoutePlannerRedirect({
  searchParams,
}: {
  searchParams: Promise<{ deliveryRouteId?: string }>;
}) {
  const { deliveryRouteId } = await searchParams;
  redirect(
    `/admin/erp/delivery-routes?tab=map${
      deliveryRouteId ? `&deliveryRouteId=${encodeURIComponent(deliveryRouteId)}` : ""
    }`
  );
}
