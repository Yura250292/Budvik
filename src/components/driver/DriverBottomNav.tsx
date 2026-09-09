"use client";

import { Truck, Map, History, MessageCircle, User } from "lucide-react";
import { TabBar, type TabDef } from "@/components/cabinet/TabBar";
import { useChatUnread } from "@/components/chat/useChatUnread";

/**
 * Нижня навігація кабінету водія: чотири розділи, і тільки вони.
 *
 * До цього водій користувався меню вітрини — «Каталог», «Кошик», «Болти» — і
 * потрапляв у кабінет покупця, де його підписували як «Клієнт». Тут лише те,
 * що потрібно на маршруті.
 *
 * Друга вкладка звалася «Клієнти», поки була просто картою бази. Тепер на
 * ній лежить відкритий маршрутний лист — лінією й пронумерованими точками,
 * — і новий водій, якому саме туди й треба по огляд дня, під назвою
 * «Клієнти» цього не шукав.
 *
 * Меню є на ВСІХ екранах водія, включно з картою дня. Спершу на
 * /driver/tablet його ховали заради висоти карти, а вихід дали кнопкою в
 * шапці — але водій на планшеті шукає перехід унизу, там, де він на решті
 * екранів, і кнопку в кутку просто не помічав.
 */
/*
  Чат — вкладкою, а не кнопкою в шапці, як у торгового й складу: у водія
  було чотири розділи, тобто місце є. Широкі вкладки (wide) довелось
  прибрати: пʼять по 72 px не влазять у 360-піксельний телефон.
*/
export default function DriverBottomNav() {
  const unread = useChatUnread();

  const tabs: TabDef[] = [
    { href: "/driver", label: "Сьогодні", icon: <Truck size={22} />, exact: true },
    { href: "/driver/map", label: "Карта", icon: <Map size={22} /> },
    { href: "/driver/history", label: "Історія", icon: <History size={22} /> },
    { href: "/driver/chat", label: "Чат", icon: <MessageCircle size={22} />, live: unread > 0 },
    { href: "/driver/profile", label: "Акаунт", icon: <User size={22} /> },
  ];

  return <TabBar tabs={tabs} />;
}
