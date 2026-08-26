/**
 * Знімки екранів застосунку через веб-збірку Metro.
 *
 * Запуск (потрібен піднятий npx expo start):
 *   node scripts/screens.mjs shots
 *
 * Браузер ставиться окремо, один раз:
 *   npx playwright install chromium
 *
 * Це не заміна перевірці на пристрої: react-native-web малює не все так само,
 * як натив — шрифти, тіні й таб-бар відрізняються. Але верстка, порожні стани,
 * заглушки завантаження й те, чи не зникає навігація при переході, видно тут
 * точно так само, і цикл правки — секунди замість збірки.
 */

import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = process.env.APP_URL ?? "http://localhost:8081";
const OUT = process.argv[2] ?? "shots";
mkdirSync(OUT, { recursive: true });

/** Розмір iPhone 14 — той самий, на якому дивиться власник. */
const VIEWPORT = { width: 390, height: 844 };

/**
 * CORS вимикаємо в самому браузері, а не на сервері.
 *
 * Нативний fetch не шле Origin, тож застосунку CORS не потрібен — і на проді
 * його свідомо немає: на тому, що крос-доменний запит упирається в preflight,
 * тримається безпека /api/device/session. Послаблювати продукт заради стенда
 * не можна, а прапорець браузера нікого поза цим процесом не стосується.
 */
const browser = await chromium.launch({
  args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
});
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});

async function shot(name, path, prepare) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  // Metro віддає бандл довго на першому запиті — чекаємо, поки з'явиться root.
  await page.waitForTimeout(prepare ? 1200 : 2500);
  if (prepare) await prepare(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`  ${name}`);
}

console.log(`знімаю ${BASE} →  ${OUT}/`);

await shot("01-home", "/");
await shot("02-catalog", "/catalog");
await shot("03-search", "/search");
await shot("04-cart", "/cart");
await shot("05-account", "/account");
await shot("06-wishlist", "/wishlist");

// Прямі адреси, а не кліки: клік по тексту в react-native-web влучає у
// вкладений вузол, а не в Pressable, і сторінка мовчки лишається тією ж.
// Окремого екрана бренда немає з часу перебудови каталогу — бренд це просто
// фільтр списку. Адреса /brand/sigma лишалась у стенді й тихо знімала «Unmatched
// Route», тобто перевірка нічого не перевіряла.
await shot("07-brand", "/list?brand=sigma&title=SIGMA");
await shot("08-product", "/product/apro-shchitka-chasha-stalevi-vytky-65-mm-dryl");
await shot("09-checkout", "/checkout");
await shot("10-orders", "/orders");

if (errors.length) {
  console.log("\nпомилки в консолі:");
  [...new Set(errors)].slice(0, 6).forEach((e) => console.log("  •", e));
} else {
  console.log("\nпомилок у консолі немає");
}

await browser.close();
