"use client";

import { CabinetProfileMenu } from "@/components/cabinet/ProfileMenu";

/**
 * Аватарка з меню у шапці торгового.
 *
 * Раніше жила лише на головній /sales, тож зі списку клієнтів чи документів
 * до профілю й виходу треба було спершу повернутися на головну. Тепер вона
 * у самій шапці — тобто на всіх екранах секції.
 *
 * Саме меню з 13.09.2026 спільне з водієм і складом
 * (components/cabinet/ProfileMenu.tsx). Тут лише своє для торгового: підпис
 * ролі, профіль зі зміною пароля й сторінка встановлення.
 */
export default function SalesProfileMenu() {
  return (
    <CabinetProfileMenu
      roleLabel="Торговий менеджер"
      profileHref="/sales/profile"
      passwordHref="/sales/profile#password"
      appPageHref="/sales/app"
    />
  );
}
