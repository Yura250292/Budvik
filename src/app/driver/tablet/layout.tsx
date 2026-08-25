import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Мій день — Budvik",
  description: "Список точок, відмітки візитів і каса за день",
};

/**
 * Темна тема статус-бара: екран майже весь зайнятий чорною шапкою й
 * списком, і жовтий брендовий колір магазину тут виглядав би випадковим.
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
