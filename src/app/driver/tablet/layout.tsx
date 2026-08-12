import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Карта дня — Budvik",
  description: "Маршрут, чек-ліст клієнтів і запис треку",
};

/**
 * Темна тема статус-бара: екран планшета майже весь зайнятий картою і
 * чорною шапкою, і жовтий брендовий колір магазину тут виглядав би
 * випадковим.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A0A0A",
  viewportFit: "cover",
};

export default function TabletLayout({ children }: LayoutProps<"/driver/tablet">) {
  return <>{children}</>;
}
