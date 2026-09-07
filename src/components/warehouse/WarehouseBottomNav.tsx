"use client";

import { ScanLine, FileText, PackageOpen, Search, User } from "lucide-react";
import { TabBar, type TabDef } from "@/components/cabinet/TabBar";

/**
 * Нижня навігація складу.
 *
 * Перша вкладка — «Зміна», а не «Сканувати», хоч сканують тут найчастіше:
 * сканер живе великою кнопкою на головній і в шапці, а от стан зміни — це
 * єдине, що людина мусить бачити з першого погляду, приходячи й ідучи.
 *
 * Помічник сюди не винесено навмисно: він у шапці, спільній для всіх екранів
 * обох кабінетів, і п'ята вкладка з'їла б підписи решти.
 */
const tabs: TabDef[] = [
  { href: "/warehouse", label: "Зміна", icon: <ScanLine size={22} />, exact: true },
  { href: "/warehouse/invoices", label: "Накладні", icon: <FileText size={22} /> },
  { href: "/warehouse/orders", label: "Збірка", icon: <PackageOpen size={22} /> },
  { href: "/warehouse/stock", label: "Товар", icon: <Search size={22} /> },
  { href: "/warehouse/profile", label: "Акаунт", icon: <User size={22} /> },
];

export default function WarehouseBottomNav() {
  return <TabBar tabs={tabs} />;
}
