import type { Metadata, Viewport } from "next";

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
  return <>{children}</>;
}
