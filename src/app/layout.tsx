import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import PageTransition from "@/components/PageTransition";
import AppMain from "@/components/AppMain";
import TestBanner from "@/components/TestBanner";
import { SITE_URL } from "@/lib/seo/site";

export const metadata: Metadata = {
  // metadataBase перетворює відносні canonical і og:image сторінок на
  // абсолютні — без нього Google ігнорує і те, і те.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Budvik27 — інструменти для професіоналів у Львові",
    template: "%s — Budvik27",
  },
  description:
    "Інтернет-магазин електро та ручного інструменту Budvik27: понад 40 000 товарів, ціни від виробників, доставка по Україні. Магазин у Львові, вул. Липинського, 36.",
  openGraph: {
    type: "website",
    locale: "uk_UA",
    siteName: "Budvik27",
    images: ["/logo.png"],
  },
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
    title: "Budvik27",
  },
};

// maximumScale/userScalable навмисно не задаємо: заблокований зум
// позбавляє можливості розтягнути дрібний або обрізаний текст, і це
// пряме порушення WCAG 1.4.4.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFD600",
  viewportFit: "cover",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-screen flex flex-col antialiased bg-[#F7F7F7]">
        <Providers>
          <Header />
          <TestBanner />
          <PageTransition>
            <AppMain>{children}</AppMain>
          </PageTransition>
          <Footer />
          <BottomNav />
          {/* AI-асистент «вікінг» прихований до готовності — компонент лишається в repo. */}
          <ServiceWorkerRegister />
        </Providers>
      </body>
    </html>
  );
}
