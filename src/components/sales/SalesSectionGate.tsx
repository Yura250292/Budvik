"use client";

import { usePathname } from "next/navigation";
import SalesGate from "./SalesGate";

/**
 * Гейт секції /sales з поправкою на каталог.
 *
 * Решта кабінету — персональна: показники, заробіток і клієнти конкретного
 * торгового, тож туди пускаємо лише SALES і ADMIN. Каталог же показує саму
 * номенклатуру, нічого приватного, а показувати товар клієнту доводиться і
 * менеджеру — тому на цьому шляху список ролей ширший.
 *
 * Перевірка живе тут, а не вкладеним layout-ом усередині /sales/catalog:
 * батьківський гейт відсіяв би MANAGER раніше, ніж вкладений встиг би його
 * впустити.
 */
const CATALOG_ROLES = ["SALES", "ADMIN", "MANAGER"] as const;

export default function SalesSectionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isCatalog = pathname.startsWith("/sales/catalog");

  return <SalesGate allow={isCatalog ? CATALOG_ROLES : undefined}>{children}</SalesGate>;
}
