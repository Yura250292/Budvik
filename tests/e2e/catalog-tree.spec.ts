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
  // Дочекатись першої картки: goto з domcontentloaded повертається до того,
  // як сітка намалювалась, і на завантаженій машині ми читали порожньо.
  await page.locator('a[href^="/catalog/"]:not([href="/catalog/zmist"])').first().waitFor();
  return page.evaluate(() => {
    // Сітка малює картку в кількох варіантах (плитка/список/компакт) і ховає
    // зайві через CSS — без дедупу за посиланням у масив потрапляли дві
    // однаково відсортовані послідовності підряд, і перевірка порядку падала.
    const seen = new Set<string>();
    return [...document.querySelectorAll('a[href^="/catalog/"]')]
      .filter((a) => a.getAttribute("href") !== "/catalog/zmist")
      .filter((a) => {
        const href = a.getAttribute("href") ?? "";
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      })
      .map((a) =>
        [...a.querySelectorAll("span")].find(
          // Перекреслена ціна — стара, до знижки: у порядок сортування вона не входить.
          (s) => /₴/.test(s.textContent ?? "") && !s.className.includes("line-through")
        )
      )
      .filter((s): s is HTMLSpanElement => Boolean(s))
      .map((s) => Number((s.textContent ?? "").replace(/[^\d,]/g, "").replace(",", ".")))
      .filter((n) => Number.isFinite(n) && n > 0);
  });
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
    // Саме банер розділу: за посиланням ?type= ховається ще й рядок сайдбару,
    // а h3 є тільки в картці.
    const card = page
      .locator('a[href^="/catalog?type="]')
      .filter({ has: page.locator("h3") })
      .filter({ hasText: "Різальний інструмент" })
      .first();
    await card.waitFor({ state: "visible" });
    await card.click();
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

test.describe("лічильники брендів", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "ліва колонка фільтрів — від md");

  test("число біля бренда дорівнює тому, що відкриється за ним", async ({ page }) => {
    await page.goto(KRUG, { waitUntil: "domcontentloaded" });

    const head = filters(page).getByRole("button", { name: /БРЕНДИ/i });
    if ((await head.getAttribute("aria-expanded")) === "false") await head.click();

    const row = filters(page).locator("label").filter({ hasText: /\d/ }).first();
    const text = await row.innerText();
    const promised = Number(text.match(/(\d+)\s*$/)![1]);
    expect(promised).toBeGreaterThan(0);

    await row.click();
    await filters(page).getByRole("button", { name: "Показати", exact: true }).click();
    // Чекаємо на застосований фільтр, а не на текст: «Знайдено 275 товарів»
    // від попередньої видачі вже на екрані й пройшов би перевірку миттєво.
    await page.waitForURL(/brand=/);
    const found = Number(
      (await page.getByText(/Знайдено [\d\s ]+ товар/).first().innerText()).match(/([\d\s ]+)/)![1].replace(/[\s ]/g, "")
    );
    // Панель обіцяє рівно те, що покаже видача: числа рахуються одним where.
    expect(found).toBe(promised);
  });

  test("бренди без товару в цій видачі не показуються", async ({ page }) => {
    await page.goto(KRUG, { waitUntil: "domcontentloaded" });

    const head = filters(page).getByRole("button", { name: /БРЕНДИ/i });
    if ((await head.getAttribute("aria-expanded")) === "false") await head.click();

    // «Без бренда» — окремий рядок у хвості списку, до порядку брендів не належить.
    const counts = (
      await filters(page).locator("label").filter({ hasText: /\d/ }).allInnerTexts()
    )
      .filter((t) => !t.includes("Без бренда"))
      .map((t) => Number(t.match(/(\d+)\s*$/)?.[1] ?? 0));
    expect(counts.length).toBeGreaterThan(2);
    expect(counts.every((n) => n > 0)).toBe(true);
    // І порядок — від найбільшого: у розділі шукають бренд, а не гортають абетку.
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});
