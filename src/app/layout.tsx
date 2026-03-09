import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import AiChatWidget from "@/components/ai/AiChatWidget";
import SwipeNavigator from "@/components/SwipeNavigator";
import PageTransition from "@/components/PageTransition";

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
  themeColor: "#0A0A0A",
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
          {/* Тестовий банер */}
          <div className="w-full bg-[#0A0A0A] border-y border-[#FFD600]/30 overflow-hidden z-40 relative">
            <div className="flex animate-marquee whitespace-nowrap py-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <span key={i} className="mx-8 text-sm font-semibold tracking-wide">
                  <span className="text-[#FFD600]">⚠</span>
                  <span className="text-white/90 mx-2">ТЕСТОВА ВЕРСІЯ — не робіть замовлення, сайт у процесі тестування!</span>
                  <span className="text-[#FFD600]">⚠</span>
                </span>
              ))}
            </div>
          </div>
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
