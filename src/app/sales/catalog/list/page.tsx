export const revalidate = 60;

import CatalogListScreen from "@/components/sales/catalog/CatalogListScreen";

/** Список товарів у кабінеті торгового. Сам екран спільний з адмінкою (/admin/catalog/list). */
export default async function SalesCatalogListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <CatalogListScreen section="sales" params={await searchParams} />;
}
