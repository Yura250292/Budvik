import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import AiChatWidget from "@/components/ai/AiChatWidget";
import SwipeNavigator from "@/components/SwipeNavigator";

export const metadata: Metadata = {
  title: "Budvik - Інструменти для професіоналів",
  description: "Магазин електро та ручного інструменту. Великий вибір, програма лояльності, швидка доставка.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Budvik",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0A0A0A",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-screen flex flex-col antialiased bg-[#F7F7F7]">
        <Providers>
          <Header />
          <SwipeNavigator>
            <main className="flex-1 pb-20 md:pb-0">{children}</main>
          </SwipeNavigator>
          <Footer />
          <BottomNav />
          <AiChatWidget />
          <ServiceWorkerRegister />
        </Providers>
      </body>
    </html>
  );
}
