import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
    deviceSizes: [640, 1080, 1920],
    imageSizes: [32, 64, 96, 192, 288, 384, 600],
    formats: ["image/webp"],
    qualities: [75],
    minimumCacheTTL: 2678400,
  },
  compress: true,
  /**
   * APK застосунку доїжджає в серверну функцію.
   *
   * /api/app/download читає файл через readFile за складеним шляхом, а
   * трасування залежностей бачить лише статичні import — без цього
   * рядка файл не потрапив би у збірку і роут віддавав би 503 саме на
   * проді, де це найважче помітити.
   *
   * У public/ покласти не можна: звідти Next віддає статику без будь-якої
   * перевірки, а застосунок ходить у бойову базу.
   */
  outputFileTracingIncludes: {
    "/api/app/download": ["./assets/app/**"],
    // /api/app/version теж торкається файлу — читає його розмір, щоб
    // сказати застосунку, скільки важить оновлення.
    "/api/app/version": ["./assets/app/**"],
    // Те саме для тестової збірки застосунку покупця: без цих рядків файл не
    // потрапляє у Vercel-бандл і роут віддає 503 саме на проді.
    "/api/app/shop/download": ["./assets/app/**"],
    "/api/app/shop/version": ["./assets/app/**"],
  },
  /**
   * Стара пагінація лендінгів `?page=N` → сегмент шляху `/storinka/N`.
   *
   * Пагінацію перенесли в шлях, бо читання `searchParams` робило бренди й
   * типи динамічними для всіх запитів — вони рендерились наживо на кожен
   * обхід робота. Без цього редіректу старе посилання мовчки показувало б
   * першу сторінку, а це гірше за помилку: людина не бачить, що потрапила
   * не туди.
   */
  async redirects() {
    const pageQuery = [{ type: "query" as const, key: "page", value: "(?<page>\\d{1,3})" }];
    return [
      {
        source: "/brand/:slug",
        has: pageQuery,
        destination: "/brand/:slug/storinka/:page",
        permanent: true,
      },
      {
        source: "/catalog/typ/:type",
        has: pageQuery,
        destination: "/catalog/typ/:type/storinka/:page",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
