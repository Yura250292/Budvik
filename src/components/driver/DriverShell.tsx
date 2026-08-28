"use client";

import DriverBottomNav from "./DriverBottomNav";
import { TAB_BAR_SPACE } from "@/components/cabinet/TabBar";

/**
 * Обгортка секції водія: полотно кабінету й відступ під нижнє меню.
 *
 * Раніше «Карта дня» була винятком — фіксованим шаром на весь екран, і
 * відступ їй тільки заважав. Тепер екран дня — звичайний список, і всі
 * сторінки секції живуть за одним правилом.
 *
 * Фон сірий (#F4F4F2), а не білий: у кабінеті всі дані лежать у білих
 * картках, і на білому тлі вони перестають читатися як картки.
 */
export default function DriverShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Кореневий main має pb-20 під навбар вітрини — у цій секції він зайвий */}
      <style>{`main { padding-bottom: 0 !important; }`}</style>
      <div className="min-h-screen bg-cab-bg" style={{ paddingBottom: TAB_BAR_SPACE }}>
        {children}
      </div>
      <DriverBottomNav />
    </>
  );
}
