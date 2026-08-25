"use client";

import DriverBottomNav from "./DriverBottomNav";

/**
 * Обгортка секції водія: відступ під нижнє меню.
 *
 * Раніше «Карта дня» була винятком — фіксованим шаром на весь екран, і
 * відступ їй тільки заважав. Тепер екран дня — звичайний список, і всі
 * сторінки секції живуть за одним правилом.
 */
export default function DriverShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Кореневий main має pb-20 під навбар вітрини — у цій секції він зайвий */}
      <style>{`main { padding-bottom: 0 !important; }`}</style>
      <div style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px) + 16px)" }}>
        {children}
      </div>
      <DriverBottomNav />
    </>
  );
}
