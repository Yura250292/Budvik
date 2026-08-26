/**
 * Дерево каталогу: крихти, розділи у фільтрах і сортування.
 *
 * Перевіряємо саме навігацію «вглиб і назад»: раніше з видачі, звуженої до
 * типу й бренда, повернутись на крок угору не було чим — лише «Скинути
 * фільтри», тобто на самий початок.
 */

import { test, expect, type Page } from "@playwright/test";

const KRUG = "/catalog?type=" + encodeURIComponent("круг");
const SECTION = "Різальний інструмент і оснастка";

const crumbs = (page: Page) => page.getByRole("navigation", { name: "Шлях по каталогу" });
const filters = (page: Page) => page.locator("aside");

/** Ціни з карток видачі — у гривнях числом, по одній на картку. */
async function prices(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/catalog/"]')]
      .filter((a) => a.getAttribute("href") !== "/catalog/zmist")
      .map((a) =>
        [...a.querySelectorAll("span")].find(
          // Перекреслена ціна — стара, до знижки: у порядок сортування вона не входить.
          (s) => /₴/.test(s.textContent ?? "") && !s.className.includes("line-through")
        )
      )
      .filter((s): s is HTMLSpanElement => Boolean(s))
      .map((s) => Number((s.textContent ?? "").replace(/[^\d,]/g, "").replace(",", ".")))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
}

test.describe("дерево каталогу", () => {
  test("крихти показують шлях розділ → тип", async ({ page }) => {
    await page.goto(KRUG, { waitUntil: "domcontentloaded" });

    const items = (await crumbs(page).innerText()).split("\n").join(" ");
    expect(items).toContain("Головна");
    expect(items).toContain("Каталог");
    expect(items).toContain(SECTION);
    expect(items).toContain("Круг");

    // Остання ланка — місце, де ми зараз: не посилання.
    await expect(crumbs(page).getByText("Круг", { exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("ланка розділу піднімає на рівень вище, а не скидає все", async ({ page }) => {
    await page.goto(KRUG, { waitUntil: "domcontentloaded" });
    await crumbs(page).getByRole("link", { name: SECTION }).click();
    // Чекаємо на сам перехід, а не на адресу з ?type=: вона вже така.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SECTION);

    // Лишились типи розділу — і їх більше, ніж один «круг».
    const types = new URL(page.url()).searchParams.get("type")!.split(",");
    expect(types.length).toBeGreaterThan(1);
    expect(types).toContain("круг");
  });

  test("з розділу можна піднятись у каталог", async ({ page }) => {
    await page.goto(KRUG, { waitUntil: "domcontentloaded" });
    await crumbs(page).getByRole("link", { name: "Каталог", exact: true }).click();
    await page.waitForURL(/\/catalog$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Каталог інструментів");
  });
});

test.describe("фільтри-дерево", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "ліва колонка фільтрів — від md");

  test("без фільтрів пропонують розділи каталогу", async ({ page }) => {
    await page.goto("/catalog", { waitUntil: "domcontentloaded" });

    const block = filters(page).getByRole("button", { name: /РОЗДІЛ/i }).first();
    await expect(block).toHaveAttribute("aria-expanded", "true");

    const options = filters(page).locator('button[aria-pressed]');
    expect(await options.count()).toBeGreaterThanOrEqual(10);
    await expect(options.filter({ hasText: "Ручний інструмент" })).toHaveCount(1);
  });

  test("вибір розділу веде у видачу цього розділу", async ({ page }) => {
    await page.goto("/catalog", { waitUntil: "domcontentloaded" });

    await filters(page).locator('button[aria-pressed]').filter({ hasText: SECTION }).click();
    await filters(page).getByRole("button", { name: "Показати", exact: true }).click();

    await page.waitForURL(/type=/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SECTION);
    await expect(crumbs(page)).toContainText(SECTION);
  });

  test("усередині розділу видно сусідні групи товару", async ({ page }) => {
    await page.goto(KRUG, { waitUntil: "domcontentloaded" });

    const group = filters(page).getByRole("button", { name: /ГРУПИ ТОВАРУ/i });
    await expect(group).toHaveAttribute("aria-expanded", "true");

    const panel = page.locator(`#${(await group.getAttribute("aria-controls"))!}`);
    for (const sibling of ["Круг", "Диск", "Свердло"]) {
      await expect(panel.getByRole("button", { name: new RegExp(`^${sibling}`) })).toBeVisible();
    }
  });

  test("групу фільтрів можна згорнути й розгорнути", async ({ page }) => {
    await page.goto("/catalog", { waitUntil: "domcontentloaded" });

    const head = filters(page).getByRole("button", { name: /ЦІНА, ГРН/i });
    const panel = page.locator(`#${(await head.getAttribute("aria-controls"))!}`);

    await expect(panel).toBeVisible();
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();

    await head.click();
    await expect(panel).toBeVisible();
  });
});

test.describe("сортування", () => {
  test("«дешевші» і «дорожчі» справді міняють порядок", async ({ page }) => {
    await page.goto(`${KRUG}&sort=price-asc`, { waitUntil: "domcontentloaded" });
    const asc = await prices(page);
    expect(asc.length).toBeGreaterThan(3);
    expect([...asc].sort((a, b) => a - b)).toEqual(asc);

    await page.goto(`${KRUG}&sort=price-desc`, { waitUntil: "domcontentloaded" });
    const desc = await prices(page);
    expect(desc.length).toBeGreaterThan(3);
    expect([...desc].sort((a, b) => b - a)).toEqual(desc);
    expect(desc[0]).toBeGreaterThan(asc[0]);
  });
});

test.describe("розділ як один вибір", () => {
  /** Заходимо так, як заходить людина: банером розділу з вітрини. */
  async function openSection(page: Page) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page
      .locator("section")
      .first()
      .locator("a.rounded-2xl")
      .filter({ hasText: "Різальний інструмент" })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SECTION);
  }

  test("цілий розділ показаний одним чипом, а не дюжиною типів", async ({ page }) => {
    await openSection(page);

    // В адресі типів багато — на екрані має бути один чип із назвою розділу.
    expect(new URL(page.url()).searchParams.get("type")!.split(",").length).toBeGreaterThan(5);
    await expect(page.getByRole("link", { name: /^Круг$/ })).toHaveCount(0);
    // Рівно одне посилання з назвою розділу — той самий чип: у крихтах
    // поточний розділ уже не посилання, а місце, де ми стоїмо.
    await expect(page.getByRole("link", { name: SECTION })).toHaveCount(1);
    // «Скинути все» тут і не потрібне: хрестик на єдиному чипі робить те саме.
  });

  test("клік по групі товару звужує розділ, а не знімає групу", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "ліва колонка фільтрів — від md");
    await openSection(page);

    await filters(page).getByRole("button", { name: /^Круг/ }).click();
    await filters(page).getByRole("button", { name: "Показати", exact: true }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Круг");
    expect(new URL(page.url()).searchParams.get("type")).toBe("круг");
  });
});
