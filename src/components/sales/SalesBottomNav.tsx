"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Store, Map, FileText, BookOpen, Gauge } from "lucide-react";
import { readShiftState, useIsNativeApp } from "@/lib/useIsNativeApp";
import { TabBar, type TabDef } from "@/components/cabinet/TabBar";

/**
 * Нижня навігація кабінету торгового: чотири рівні вкладки.
 *
 * Центральної кнопки «Продаж» більше немає. Торгові поки не оформлюють
 * замовлення через застосунок, тож найпомітніший елемент екрана вів у
 * функцію, якою не користуються. Сторінка /sales/new лишилась на місці —
 * прибрано лише входи, тож повернути її можна одним комітом.
 *
 * «Комісії» (/dashboard/commissions) свого часу замінило «Показники»:
 * там стара ERP-схема, де комісія нараховується при підтвердженні
 * замовлення — ще до відвантаження і до будь-якої оплати. Тримати дві
 * різні суми заробітку поруч у меню означало б гарантоване питання «а
 * чому не сходиться». Заробіток рахується зі зібраних коштів і живе в
 * /sales/analytics/money.
 *
 * П'ять вкладок — стеля для телефона, шоста ріже цілі дотику. Тому місце
 * «Заробітку» зайняв каталог: заробіток дивляться раз на день і з головної
 * (плитка в MetricGrid), а каталог відкривають у кожному візиті — він
 * заміняє вісім паперових каталогів, які торговий возить у машині.
 */
export default function SalesBottomNav() {
  const pathname = usePathname();
  const isApp = useIsNativeApp();
  const [shiftOpen, setShiftOpen] = useState(false);

  /**
   * Стан зміни перечитуємо при кожній навігації: торговий міг щойно
   * відкрити зміну на нативному екрані й повернутись у кабінет.
   */
  useEffect(() => {
    if (!isApp) return;
    setShiftOpen(readShiftState()?.open ?? false);
  }, [isApp, pathname]);

  const size = 22;
  const tabs: TabDef[] = [
    { href: "/sales", label: "Головна", icon: <LayoutDashboard size={size} />, exact: true },
    { href: "/sales/clients", label: "Клієнти", icon: <Store size={size} /> },
    // Поруч із клієнтами, бо це той самий портфель, тільки на місцевості:
    // видно, хто мовчить і чи він по дорозі сьогоднішнім маршрутом.
    { href: "/sales/map", label: "Карта", icon: <Map size={size} /> },
    { href: "/sales/orders", label: "Документи", icon: <FileText size={size} /> },
    { href: "/sales/catalog", label: "Каталог", icon: <BookOpen size={size} /> },
  ];

  /*
    Шоста вкладка живе тільки в застосунку. Стеля з п'яти вкладок писалась для
    телефона у звичайному браузері; тут інший випадок — без цієї кнопки
    нативний екран зміни не має входу взагалі, бо іншої навігації в застосунку
    немає. Це кнопка, а не посилання: вона нікуди не веде в межах сайту, а
    гукає натив через міст, і активною не буває.
  */
  if (isApp) {
    tabs.push({
      label: "Зміна",
      icon: <Gauge size={size} />,
      onClick: () => window.BudvikApp?.openShift(),
      // Крапка, поки зміна відкрита: єдиний спосіб побачити з кабінету, що
      // трек пишеться.
      live: shiftOpen,
    });
  }

  return <TabBar tabs={tabs} />;
}
