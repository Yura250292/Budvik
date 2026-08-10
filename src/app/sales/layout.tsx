import type { Metadata, Viewport } from "next";
import SalesBottomNav from "@/components/sales/SalesBottomNav";
import SalesGate from "@/components/sales/SalesGate";

export const metadata: Metadata = {
  title: "Budvik — Торговий",
};

/**
 * userScalable не вимикаємо. Раніше тут стояло maximumScale: 1 —
 * з ним обрізаний або дрібний текст неможливо було розтягнути пальцями,
 * а на складі й у машині це єдиний спосіб прочитати номер документа.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <SalesGate>
      {/*
        Відступ під навбар живе тут, а не на кожній сторінці. SalesBottomNav —
        fixed h-16 плюс safe-area, і без цього він накриває останню картку.
        Раніше кожен екран вписував "100px" вручну (а /sales/analytics — pb-28),
        тож будь-який новий екран приходив без відступу і різався.

        Кореневий main має pb-20 для BottomNav вітрини; у цій секції він зайвий
        — обнуляємо його тут, а свій відступ ставимо нижче.
      */}
      <style>{`main { padding-bottom: 0 !important; }`}</style>
      <div style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px) + 16px)" }}>
        {children}
      </div>
      <SalesBottomNav />
    </SalesGate>
  );
}
