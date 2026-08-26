/**
 * Перший екран головної: банери розділів, смуга решти розділів і сайдбар.
 *
 * Перевіряємо не «чи є верстка», а те, через що ця частина сайту вже ламалась:
 * фото розділу з чужого сервера, яке віддає 404; підпис «352 позицій» замість
 * «позиції»; посилання, що веде в порожній каталог; сітка, яка на телефоні
 * виїжджає за екран.
 */

import { test, expect, type Page, type Locator } from "@playwright/test";

/** Порядок і склад банерів — це домовленість, а не випадковість (SectionDef.featured). */
const FEATURED = [
  "Ручний інструмент",
  "Оснастка та витратні",
  "Електроінструмент",
  "Садова техніка й полив",
  "Малярний інструмент",
  "Кріплення та метизи",
];

/** Те саме правило множини, що й у lib/utils — тут навмисно окремою копією. */
function positions(n: number): string {
  const tens = n % 100;
  if (tens > 10 && tens < 20) return "позицій";
  const ones = n % 10;
  if (ones === 1) return "позиція";
  if (ones >= 2 && ones <= 4) return "позиції";
  return "позицій";
}

const showcase = (page: Page) => page.locator("section").first();
const cards = (page: Page) => showcase(page).locator('a[href^="/catalog?section="].rounded-2xl');

/** Чи справді картинка намальована, а не висить піктограмою битого файлу. */
async function isDecoded(img: Locator): Promise<boolean> {
  return img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0 && el.naturalHeight > 0);
}

test.beforeEach(async ({ page }) => {
  // Не networkidle: дев-сервер тримає сокет HMR відкритим, тож «мережа стихла»
  // не настає ніколи, і чекання впирається в тайм-аут тесту.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(cards(page).first()).toBeVisible();
});

test("шість головних розділів показані банерами, у заданому порядку", async ({ page }) => {
  const titles = await cards(page).locator("h3").allInnerTexts();
  expect(titles.map((t) => t.trim())).toEqual(FEATURED);
});

test("на банері є назва, перелік типів і кількість позицій", async ({ page }) => {
  const list = cards(page);
  for (let i = 0; i < FEATURED.length; i++) {
    const card = list.nth(i);
    await expect(card.locator("h3")).toHaveText(FEATURED[i]);
    // Рядок під назвою: «валики, пензлі, шпателі…» — не порожній і не назва вдруге.
    const summary = (await card.locator("p").innerText()).trim();
    expect(summary.length).toBeGreaterThan(5);
    expect(summary).not.toBe(FEATURED[i]);
    await expect(card).toContainText(/\d[\d \s]*\s(позиція|позиції|позицій)/);
  }
});

test("кількість узгоджена з українською множиною", async ({ page }) => {
  const pills = await showcase(page).getByText(/\d[\d \s]*\s(позиція|позиції|позицій)/).allInnerTexts();
  expect(pills.length).toBeGreaterThanOrEqual(FEATURED.length);
  for (const text of pills) {
    const m = text.match(/([\d \s]+)\s(позиція|позиції|позицій)/);
    expect(m, `не розібрав «${text}»`).not.toBeNull();
    const n = Number(m![1].replace(/[ \s]/g, ""));
    expect(`${n} → ${m![2]}`).toBe(`${n} → ${positions(n)}`);
  }
});

test("фото розділів завантажились із власного сховища", async ({ page }) => {
  const images = showcase(page).locator("img");
  const count = await images.count();
  expect(count).toBeGreaterThanOrEqual(FEATURED.length);

  for (let i = 0; i < count; i++) {
    const img = images.nth(i);
    const src = (await img.getAttribute("src")) ?? "";
    // next/image переписує адресу в /_next/image?url=…: розпаковуємо оригінал.
    const original = decodeURIComponent(new URL(src, "http://localhost").searchParams.get("url") ?? src);
    if (!original.startsWith("http")) continue; // локальні svg-заглушки не рахуємо
    expect(original, "фото мусить лежати у власному сховищі, а не на сайті постачальника")
      .toContain("files.budvik27.com");
    expect(await isDecoded(img), `не намалювалось: ${original}`).toBe(true);
  }
});

test("жодне зображення першого екрана не віддає помилку", async ({ page }) => {
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.request().resourceType() === "image" && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.reload({ waitUntil: "load" });
  const images = showcase(page).locator("img");
  await images.first().waitFor();
  await expect
    .poll(async () => images.evaluateAll((els) => els.every((el) => (el as HTMLImageElement).complete)))
    .toBe(true);
  expect(failed).toEqual([]);
});

test("банер веде у свій розділ каталогу і той не порожній", async ({ page }) => {
  const card = cards(page).filter({ hasText: "Ручний інструмент" }).first();
  const href = await card.getAttribute("href");
  expect(href).toMatch(/^\/catalog\?section=/);

  await card.click();
  await page.waitForURL(/\/catalog\?section=/);

  // «Не порожній» — це не «щось намалювалось»: фільтр розділу міг би дати
  // нуль товарів і сторінка все одно виглядала б цілою.
  const found = page.getByText(/Знайдено [\d\s ]+ товар/).first();
  await expect(found).toBeVisible();
  const n = Number((await found.innerText()).match(/([\d\s ]+)/)![1].replace(/[\s ]/g, ""));
  expect(n).toBeGreaterThan(0);
  const productCards = page
    .locator('a[href^="/catalog/"]:not([href="/catalog/zmist"])')
    .filter({ has: page.locator("img") });
  await expect(productCards.first()).toBeVisible();
});

test("знаки розділів — не emoji", async ({ page }) => {
  // Emoji малює шрифт системи: різний вигляд на кожному пристрої, та й 🎨
  // однаково позначає фарбу, дизайн і свято.
  const text = await showcase(page).innerText();
  const emoji = text.match(/\p{Extended_Pictographic}/gu) ?? [];
  expect(emoji).toEqual([]);
  expect(await showcase(page).locator("svg").count()).toBeGreaterThan(FEATURED.length);
});

test("сторінка не їде вбік", async ({ page }) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test("смуга решти розділів веде в каталог і має фото", async ({ page }) => {
  const strip = page.getByRole("heading", { name: "Ще розділи" }).locator("xpath=../..");
  const tiles = strip.locator('a[href^="/catalog?section="]');
  expect(await tiles.count()).toBeGreaterThanOrEqual(6);

  for (let i = 0; i < (await tiles.count()); i++) {
    const tile = tiles.nth(i);
    await expect(tile).toHaveAttribute("aria-label", /позиц/);
    const img = tile.locator("img");
    // Розділ без жодного фото малює свій знак — це припустимо, битий файл — ні.
    if (await img.count()) expect(await isDecoded(img.first())).toBe(true);
    else await expect(tile.locator("svg")).toHaveCount(1);
  }
});

test("у кожен банер можна влучити пальцем", async ({ page }) => {
  const list = cards(page);
  for (let i = 0; i < (await list.count()); i++) {
    const box = await list.nth(i).boundingBox();
    expect(box!.height, "менше за 44px — не влучиш пальцем").toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
});

test("банер підписаний для читача з екрана", async ({ page }) => {
  const list = cards(page);
  for (let i = 0; i < (await list.count()); i++) {
    await expect(list.nth(i)).toHaveAttribute("aria-label", /.+, \d[\d \s]*\s(позиція|позиції|позицій)/);
    // Фото — оформлення: воно не повинно диктувати підпис посилання.
    const img = list.nth(i).locator("img");
    if (await img.count()) {
      await expect(img.first()).toHaveAttribute("alt", "");
      await expect(img.first()).toHaveAttribute("aria-hidden", "true");
    }
  }
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
  (css.match(/rgba?\(([^)]+)\)/)![1].split(",").slice(0, 3).map((n) => Number(n.trim())));

test("написи на банерах читаються на власному тоні розділу", async ({ page }) => {
  const list = cards(page);
  for (let i = 0; i < (await list.count()); i++) {
    const card = list.nth(i);
    // Тон — перший колір градієнта, тобто найтемніший край підкладки:
    // якщо напис проходить на ньому, то пройде і на світлішому.
    const tint = rgb(await card.evaluate((el) => getComputedStyle(el).backgroundImage));

    for (const part of ["h3", "p"]) {
      const node = card.locator(part).first();
      if (!(await node.count())) continue;
      const color = rgb(await node.evaluate((el) => getComputedStyle(el).color));
      const ratio = contrast(color, tint);
      const text = (await node.innerText()).slice(0, 30);
      expect(Number(ratio.toFixed(2)), `«${text}» — контраст нижчий за 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
