"use client";

import WarehouseBottomNav from "./WarehouseBottomNav";
import { TAB_BAR_SPACE } from "@/components/cabinet/TabBar";

/**
 * Полотно секції складу й відступ під нижнє меню.
 *
 * Те саме, що у водія: сірий фон, бо всі дані лежать у білих картках, а на
 * білому тлі вони перестають читатися як картки.
 */
export default function WarehouseShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Кореневий main має pb-20 під навбар вітрини — у цій секції він зайвий */}
      <style>{`main { padding-bottom: 0 !important; }`}</style>
      <div className="min-h-screen bg-cab-bg" style={{ paddingBottom: TAB_BAR_SPACE }}>
        {children}
      </div>
      <WarehouseBottomNav />
    </>
  );
}
