import CatalogListScreen from "@/components/sales/catalog/CatalogListScreen";

export const metadata = { title: "Каталог товарів" };

/** Список товарів у шеллі адмінки — той самий, що /sales/catalog/list, див. /admin/catalog. */
export default async function AdminCatalogListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <CatalogListScreen section="admin" params={await searchParams} />;
}
