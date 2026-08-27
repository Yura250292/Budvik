import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /*
     * Білий список хостів, а не "**".
     *
     * Оптимізатор Next не віддає картинку сам — він іде за нею зі своєї
     * функції на той хост, який стоїть у src. З "**" це означало дві речі.
     *
     * Перша: /_next/image працював як відкритий проксі — будь-хто міг
     * підставити чужу адресу й ганяти трафік Vercel за наш рахунок.
     *
     * Друга, вже помічена: коли хост із бази вмирає, кожен показ картки
     * стає невдалим викликом функції. Домен budsnabzbut.ua зник, посилання
     * на його фото лишилось у товарі з 3 277 шт. на складі — і /_next/image
     * віддавав 502 на кожну появу картки в стрічці. 502 не кешується, тож
     * це повторювалось нескінченно.
     *
     * Фото товарів переїхали до нас у R2 (scripts/mirror-foreign-images.mts),
     * тож чужі хости більше не потрібні. Хост із чужим фото тепер отримає
     * швидкий 400, а не похід за океан, і картка покаже заглушку NoPhoto.
     */
    remotePatterns: [
      // Фото товарів і логотипи брендів у R2.
      { protocol: "https", hostname: "files.budvik27.com" },
      // Логотипи брендів, що лежать у public/ і записані повною адресою.
      { protocol: "https", hostname: "www.budvik27.com" },
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
