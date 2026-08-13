"use client";

import { usePathname } from "next/navigation";
import DriverBottomNav from "./DriverBottomNav";

/**
 * Обгортка секції водія: відступ під нижнє меню.
 *
 * «Карта дня» (/driver/tablet) — фіксований шар на весь екран, тож звичайний
 * padding їй не допоміг би: вона позиціонується від країв вікна, а не від
 * потоку. Їй віддаємо змінну --driver-nav-h, якою вона сама піднімає свій
 * низ над меню.
 */
export default function DriverShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fixedLayer = pathname?.startsWith("/driver/tablet") ?? false;

  return (
    <>
      {/* Кореневий main має pb-20 під навбар вітрини — у цій секції він зайвий */}
      <style>{`main { padding-bottom: 0 !important; }`}</style>
      <div
        style={
          fixedLayer
            ? undefined
            : { paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px) + 16px)" }
        }
      >
        {children}
      </div>
      <DriverBottomNav />
    </>
  );
}
