export const revalidate = 3600;

import CatalogTocScreen from "@/components/sales/catalog/CatalogTocScreen";

/** Зміст каталогу в кабінеті торгового. Сам екран спільний з адмінкою (/admin/catalog). */
export default function SalesCatalogPage() {
  return <CatalogTocScreen section="sales" />;
}
