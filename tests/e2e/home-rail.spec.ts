/**
 * Бокова колонка розділів — головний вхід у каталог на десктопі.
 *
 * На вузьких екранах її немає навмисно (там працюють банери й смуга), тож
 * увесь файл — про десктоп.
 */

import { test, expect } from "@playwright/test";

test.describe("сайдбар розділів", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, "сайдбар з'являється від lg");

  test.beforeEach(async ({ page }) => {
    // Не networkidle: дев-сервер тримає сокет HMR відкритим і «мережа
    // стихла» не настає ніколи.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Розділи каталогу" })).toBeVisible();
  });

  test("показує весь зміст каталогу, з кількостями і знаками", async ({ page }) => {
    const rail = page.getByRole("navigation", { name: "Розділи каталогу" });
    await expect(rail).toBeVisible();

    const rows = rail.locator('a[href^="/catalog?section="]');
    const n = await rows.count();
    expect(n).toBeGreaterThanOrEqual(10);

    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      await expect(row.locator("svg").first()).toBeVisible();
      await expect(row).toContainText(/\d+/);
      const box = await row.boundingBox();
      expect(box!.height, "рядок нижчий за 44px").toBeGreaterThanOrEqual(44);
    }

    await expect(rail.getByRole("link", { name: /Усі розділи й типи/ })).toHaveAttribute("href", "/catalog/zmist");
  });

  test("кількість у сайдбарі збігається з кількістю на банері", async ({ page }) => {
    const rail = page.getByRole("navigation", { name: "Розділи каталогу" });
    const railRow = rail.locator('a[href^="/catalog?section="]').filter({ hasText: "Ручний інструмент" }).first();
    const railCount = (await railRow.innerText()).match(/(\d+)/)![1];

    const card = page.locator('a[href^="/catalog?section="]').filter({ hasText: "Ручний інструмент" }).nth(1);
    const cardCount = (await card.innerText()).match(/([\d \s]+)\s(позиція|позиції|позицій)/)![1].replace(/[ \s]/g, "");

    expect(cardCount).toBe(railCount);
  });

  test("наведення підсвічує рядок жовтою смужкою", async ({ page }) => {
    const row = page
      .getByRole("navigation", { name: "Розділи каталогу" })
      .locator('a[href^="/catalog?section="]')
      .first();
    const accent = row.locator("span").first();

    // Міряємо намальовану висоту, а не рядок CSS: як саме зібраний клас
    // (transform чи scale), тесту знати не треба — важливо, що смужку видно.
    const rowHeight = (await row.boundingBox())!.height;
    expect((await accent.boundingBox())!.height, "до наведення смужки не видно").toBeLessThan(2);

    await row.hover();
    await page.waitForTimeout(400);

    expect((await accent.boundingBox())!.height).toBeGreaterThanOrEqual(rowHeight - 1);
    expect(await accent.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 214, 0)");
  });

  test("на банері розділу наведення міняє значок і кнопку", async ({ page }) => {
    const card = page.locator('a[href^="/catalog?section="]').filter({ hasText: "Малярний інструмент" }).nth(1);
    const pill = card.locator("span").filter({ hasText: /позиц/ }).first();

    const before = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
    await card.hover();
    await page.waitForTimeout(400);
    const after = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);

    expect(before).not.toBe(after);
    expect(after).toBe("rgb(10, 10, 10)");
  });

  test("фокус із клавіатури видно", async ({ page }) => {
    const row = page
      .getByRole("navigation", { name: "Розділи каталогу" })
      .locator('a[href^="/catalog?section="]')
      .first();

    await row.focus();
    const outline = await row.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
    });
    expect(outline.style).not.toBe("none");
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(1);
  });
});

test.describe("телефон", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, "перевірка про вузький екран");

  test("банери стоять в одну колонку, сайдбар схований", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Розділи каталогу" })).toBeHidden();

    const cards = page.locator("section").first().locator('a[href^="/catalog?section="].rounded-2xl');
    const boxes = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
    expect(new Set(boxes.map((x) => Math.round(x))).size, "картки мають стояти одна під одною").toBe(1);
  });
});
