import type { Metadata, Viewport } from "next";
import SalesBottomNav from "@/components/sales/SalesBottomNav";

export const metadata: Metadata = {
  title: "Budvik — Торговий",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`main { padding-bottom: 0 !important; }`}</style>
      {children}
      <SalesBottomNav />
    </>
  );
}
