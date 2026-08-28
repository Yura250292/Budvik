"use client";

import { Truck, Map, History, User } from "lucide-react";
import { TabBar, type TabDef } from "@/components/cabinet/TabBar";

/**
 * Нижня навігація кабінету водія: чотири розділи, і тільки вони.
 *
 * До цього водій користувався меню вітрини — «Каталог», «Кошик», «Болти» — і
 * потрапляв у кабінет покупця, де його підписували як «Клієнт». Тут лише те,
 * що потрібно на маршруті.
 *
 * Меню є на ВСІХ екранах водія, включно з картою дня. Спершу на
 * /driver/tablet його ховали заради висоти карти, а вихід дали кнопкою в
 * шапці — але водій на планшеті шукає перехід унизу, там, де він на решті
 * екранів, і кнопку в кутку просто не помічав.
 */
const tabs: TabDef[] = [
  { href: "/driver", label: "Сьогодні", icon: <Truck size={22} />, exact: true },
  { href: "/driver/map", label: "Клієнти", icon: <Map size={22} /> },
  { href: "/driver/history", label: "Історія", icon: <History size={22} /> },
  { href: "/driver/profile", label: "Акаунт", icon: <User size={22} /> },
];

export default function DriverBottomNav() {
  return <TabBar tabs={tabs} wide />;
}
