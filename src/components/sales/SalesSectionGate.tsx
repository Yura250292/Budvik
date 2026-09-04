"use client";

import { usePathname } from "next/navigation";
import SalesGate from "./SalesGate";

/**
 * Гейт секції /sales з поправкою на каталог.
 *
 * Решта кабінету — персональна: показники, заробіток і клієнти конкретного
 * торгового, тож туди пускаємо лише SALES і ADMIN. Каталог і помічник
 * приватного не показують, тому на цих шляхах список ролей ширший.
 *
 * Перевірка живе тут, а не вкладеним layout-ом усередині /sales/catalog:
 * батьківський гейт відсіяв би MANAGER раніше, ніж вкладений встиг би його
 * впустити.
 */
const WIDE_ROLES = ["SALES", "ADMIN", "MANAGER"] as const;

/**
 * Шляхи, де ширший список ролей.
 *
 * Каталог показує саму номенклатуру, нічого приватного. Помічник теж не
 * персональний: чиї дані читати, він питає окремо (керівник обирає
 * торгового при створенні розмови), а сам по собі нічиїх показників не
 * показує — тому менеджеру тут місце.
 */
const WIDE_PATHS = ["/sales/catalog", "/sales/assistant"];

export default function SalesSectionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = WIDE_PATHS.some((p) => pathname.startsWith(p));

  return <SalesGate allow={wide ? WIDE_ROLES : undefined}>{children}</SalesGate>;
}
