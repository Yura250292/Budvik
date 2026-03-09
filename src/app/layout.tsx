import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import AiChatWidget from "@/components/ai/AiChatWidgetLoader";
import SwipeNavigator from "@/components/SwipeNavigator";
import PageTransition from "@/components/PageTransition";
import TestBanner from "@/components/TestBanner";

export const metadata: Metadata = {
  title: "Budvik - Інструменти для професіоналів",
  description: "Магазин електро та ручного інструменту. Великий вибір, програма лояльності, швидка доставка.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
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
  themeColor: "#FFD600",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-screen flex flex-col antialiased bg-[#F7F7F7]">
        <Providers>
          <Header />
          <TestBanner />
          <SwipeNavigator>
            <PageTransition>
              <main className="flex-1 pb-20 md:pb-0">{children}</main>
            </PageTransition>
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
