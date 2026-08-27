/**
 * Вітрина брендів на головній.
 *
 * Перевіряємо те, через що ця частина сайту вже ламалась або могла зламатись:
 * посилання на бренд, якого немає в базі (у старому списку слаги були свої, не
 * ті, що в базі, — половина плиток вела в 404); лічильник, який обіцяє більше,
 * ніж покажуть за кліком; фото з чужого сервера, яке оптимізатор Next віддає
 * помилкою; напис на фірмовому кольорі, який не читається.
 */

import { test, expect, type Page, type Locator } from "@playwright/test";

/** Склад вітрини — домовленість (SHOWCASE у lib/catalog/brand-showcase.ts). */
const BRANDS = ["total", "polax", "grosser", "apro", "unifix", "aurora", "sigma", "syla"];

/** Те саме правило множини, що й у lib/utils — тут навмисно окремою копією. */
function positions(n: number): string {
  const tens = n % 100;
  if (tens > 10 && tens < 20) return "позицій";
  const ones = n % 10;
  if (ones === 1) return "позиція";
  if (ones >= 2 && ones <= 4) return "позиції";
  return "позицій";
}

const showcase = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Бренди", exact: true }) });
const banners = (page: Page) => showcase(page).locator('a[href^="/brand/"]');

async function isDecoded(img: Locator): Promise<boolean> {
  return img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0 && el.naturalHeight > 0);
}

test.beforeEach(async ({ page }) => {
  // Не networkidle: дев-сервер тримає сокет HMR відкритим, тож «мережа стихла»
  // не настає ніколи, і чекання впирається в тайм-аут тесту.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(banners(page).first()).toBeVisible();
});

test("бренди показані банерами, у заданому складі й порядку", async ({ page }) => {
  const hrefs = await banners(page).evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  expect(hrefs).toEqual(BRANDS.map((slug) => `/brand/${slug}`));
});

test("на банері є знак бренда, слоган і кількість позицій", async ({ page }) => {
  const list = banners(page);
  for (let i = 0; i < (await list.count()); i++) {
    const banner = list.nth(i);
    // Знак — або справжній логотип, або напис назвою. Порожнього банера не буває.
    const hasLogo = (await banner.locator("img[alt]:not([alt=''])").count()) > 0;
    const hasWordmark = (await banner.locator("span.uppercase").count()) > 0;
    expect(hasLogo || hasWordmark, "бренд без знака").toBe(true);

    await expect(banner).toContainText(/\d[\d \s]*\s(позиція|позиції|позицій)/);
    // Слоган їде в підпис навіть тоді, коли на вузькому екрані його не видно.
    await expect(banner).toHaveAttribute("aria-label", /.+ — .+, \d/);
  }
});

test("кількість узгоджена з українською множиною", async ({ page }) => {
  const pills = await showcase(page).getByText(/\d[\d \s]*\s(позиція|позиції|позицій)/).allInnerTexts();
  expect(pills.length).toBeGreaterThanOrEqual(BRANDS.length);
  for (const text of pills) {
    const m = text.match(/([\d \s]+)\s(позиція|позиції|позицій)/);
    expect(m, `не розібрав «${text}»`).not.toBeNull();
    const n = Number(m![1].replace(/[ \s]/g, ""));
    expect(`${n} → ${m![2]}`).toBe(`${n} → ${positions(n)}`);
  }
});

test("знімки товарів завантажились із власного сховища", async ({ page }) => {
  const images = showcase(page).locator("img");
  const count = await images.count();
  expect(count).toBeGreaterThanOrEqual(BRANDS.length);

  for (let i = 0; i < count; i++) {
    const img = images.nth(i);
    const src = (await img.getAttribute("src")) ?? "";
    // next/image переписує адресу в /_next/image?url=…: розпаковуємо оригінал.
    const original = decodeURIComponent(new URL(src, "http://localhost").searchParams.get("url") ?? src);
    if (!original.startsWith("http")) continue; // локальні svg-логотипи не рахуємо
    expect(original, "знімок мусить лежати у власному сховищі, а не на сайті постачальника")
      .toContain("budvik27.com");
    expect(await isDecoded(img), `не намалювалось: ${original}`).toBe(true);
  }
});

test("банер веде на сторінку бренда, і та не порожня", async ({ page }) => {
  // Шукаємо за адресою, а не за написом: у бренда з логотипом назва лежить в
  // alt картинки, і hasText її не бачить.
  const banner = showcase(page).locator('a[href="/brand/total"]').first();
  await banner.click();
  await page.waitForURL("**/brand/total");

  // «Не порожня» — це не «щось намалювалось»: фільтр бренда міг би дати нуль
  // товарів, і сторінка все одно виглядала б цілою.
  await expect(page.getByRole("heading", { name: /Інструменти TOTAL/ })).toBeVisible();
  const productCards = page
    .locator('a[href^="/catalog/"]:not([href="/catalog/zmist"])')
    .filter({ has: page.locator("img") });
  await expect(productCards.first()).toBeVisible();
});

test("лічильник банера збігається з тим, що показує сторінка бренда", async ({ page }) => {
  /*
   * Найтонше місце цієї вітрини. Дерево брендів рахує всі активні картки, а
   * сторінка показує лише наявне з ціною: для SIGMA це 3202 проти 1606. Банер
   * мусить обіцяти рівно те, що покупець побачить за кліком.
   */
  const banner = showcase(page).locator('a[href="/brand/sigma"]').first();
  const promised = Number(
    (await banner.innerText()).match(/([\d \s]+)\s(позиція|позиції|позицій)/)![1].replace(/[ \s]/g, "")
  );

  await banner.click();
  await page.waitForURL("**/brand/sigma");
  const shown = Number(
    (await page.locator("h1").locator("xpath=..").innerText())
      .match(/([\d \s]+)\s(позиція|позиції|позицій)/)![1]
      .replace(/[ \s]/g, "")
  );
  expect(shown).toBe(promised);
});

test("знаки брендів — не emoji", async ({ page }) => {
  const text = await showcase(page).innerText();
  expect(text.match(/\p{Extended_Pictographic}/gu) ?? []).toEqual([]);
});

test("у кожен банер можна влучити пальцем", async ({ page }) => {
  const list = banners(page);
  for (let i = 0; i < (await list.count()); i++) {
    const box = await list.nth(i).boundingBox();
    expect(box!.height, "менше за 44px — не влучиш пальцем").toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
});

test("сторінка не їде вбік", async ({ page }) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

/** Відносна яскравість за WCAG. */
function luminance([r, g, b]: number[]): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: number[], b: number[]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const rgb = (css: string): number[] =>
  css.match(/rgba?\(([^)]+)\)/)![1].split(",").slice(0, 3).map((n) => Number(n.trim()));

test("написи на банерах читаються на фірмовому кольорі", async ({ page }) => {
  const list = banners(page);
  for (let i = 0; i < (await list.count()); i++) {
    const banner = list.nth(i);
    // Тон — перший колір градієнта, тобто найсвітліший край підкладки.
    const accent = rgb(await banner.evaluate((el) => getComputedStyle(el).backgroundImage));

    for (const node of [banner.locator("span.uppercase").first(), banner.locator("p").first()]) {
      if (!(await node.count())) continue;
      if (!(await node.isVisible())) continue;
      const color = rgb(await node.evaluate((el) => getComputedStyle(el).color));
      const text = (await node.innerText()).slice(0, 30);
      const ratio = contrast(color, accent);
      expect(Number(ratio.toFixed(2)), `«${text}» — контраст нижчий за 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
