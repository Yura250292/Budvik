import CatalogTocScreen from "@/components/sales/catalog/CatalogTocScreen";

export const metadata = { title: "Каталог товарів" };

/**
 * Каталог усередині шелла адмінки.
 *
 * До цього пункт сайдбару вів на /sales/catalog, а там свій layout кабінету
 * торгового — нижня панель і шапка під планшет. Керівник за монітором
 * випадав із панелі управління на екран планшета. Екран той самий, що й у
 * кабінеті; від section залежать лише обгортка й адреси посилань.
 */
export default function AdminCatalogPage() {
  return <CatalogTocScreen section="admin" />;
}
