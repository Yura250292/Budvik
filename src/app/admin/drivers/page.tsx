import { redirect } from "next/navigation";
import { forwardQuery, type SearchParams } from "@/app/admin/logistics/forward-query";

/**
 * «Аналітика водіїв» розчинилася в розділі «Логістика» (13.09.2026).
 *
 * Карта «На маршруті» стала «Рухом на карті» — там і торгові, і водії;
 * журнал листів ще раніше переїхав у маршрути доставки; зарплата, каса й
 * налаштування — «Водії: зарплата і каса». Редірект, а не видалення: на
 * ?tab=payroll&driver=… ведуть закладки й посилання AI-аналізу.
 */
export default async function DriversRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  if (sp.tab === "live") redirect("/admin/logistics/live");
  if (sp.tab === "sheets") {
    redirect(forwardQuery("/admin/logistics/delivery", { ...sp, tab: "journal" }, ["tab", "from", "to"]));
  }
  redirect(forwardQuery("/admin/logistics/drivers", sp, ["tab", "driver", "from", "to"]));
}
