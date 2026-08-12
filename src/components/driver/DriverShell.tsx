"use client";

import { usePathname } from "next/navigation";
import DriverBottomNav from "./DriverBottomNav";

/**
 * Обгортка секції водія: відступ під навбар — лише там, де навбар є.
 *
 * «Карта дня» (/driver/tablet) працює на весь екран без нижньої панелі:
 * планшет стоїть у тримачі, і відступ у 4rem з'їдав би видиму територію
 * та лишав білу смугу під картою.
 */
export default function DriverShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullscreen = pathname?.startsWith("/driver/tablet") ?? false;

  return (
    <>
      {/* Кореневий main має pb-20 під навбар вітрини — у цій секції він зайвий */}
      <style>{`main { padding-bottom: 0 !important; }`}</style>
      <div
        style={
          fullscreen
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
