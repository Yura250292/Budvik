/**
 * Чат персоналу: доставка між двома сесіями, статуси, дві колонки, смайлики.
 *
 * Пишемо ТІЛЬКИ в особисту розмову двох тестових акаунтів. Чат уже живий, і
 * повідомлення в «Усі» чи в групу ролі побачила б уся фірма — а надіслане
 * через роут ще й розлетілося б пушами.
 *
 * Запуск (сервер уже піднятий):
 *   E2E_NO_SERVER=1 E2E_BASE_URL=http://localhost:3100 \
 *     CHAT_E2E_USERS='<json>' npx playwright test tests/e2e/staff-chat.spec.ts
 *
 * CHAT_E2E_USERS — токени тестових акаунтів; без них тест пропускається.
 */

import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

type Who = { id: string; name: string; token: string };
const USERS: Record<string, Who> | null = process.env.CHAT_E2E_USERS
  ? JSON.parse(process.env.CHAT_E2E_USERS)
  : null;

const BASE = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3100");

/** Ключ особистої розмови: id обох, відсортовані — як на сервері. */
const dmKey = (a: string, b: string) => (a < b ? `dm-${a}-${b}` : `dm-${b}-${a}`);

async function loginAs(context: BrowserContext, who: Who) {
  // Обидва імені: middleware читає __Secure-, клієнтський /api/auth/session — просте.
  // secure навіть на http: без нього Chrome відкидає кукі з префіксом
  // __Secure- разом з усім набором, а на localhost вона допускається.
  await context.addCookies(
    ["next-auth.session-token", "__Secure-next-auth.session-token"].map((name) => ({
      name,
      value: who.token,
      domain: BASE.hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    }))
  );
}

const stamp = () => `тест ${Date.now().toString().slice(-6)}`;

/**
 * Саме бульбашка в стрічці, а не будь-де на екрані.
 *
 * Той самий текст стоїть ще й у переліку розмов збоку (як «останнє
 * повідомлення»), тож пошук по всій сторінці знаходить два збіги. Бульбашка —
 * це <p>, рядок переліку — <span>.
 */
const bubble = (page: Page, text: string) => page.getByRole("paragraph").filter({ hasText: text });

/**
 * Натиснути кнопку в мобільному контексті.
 *
 * `click()` у проєкті «mobile» шле МИШУ на пристрій, який емулює дотик, і
 * така подія до сторінки не доходить: поле лишається заповненим, запиту
 * немає. Живий палець і миша на ноутбуці працюють обидва — тому тут саме
 * `tap()`, з відкотом на клік там, де дотику немає.
 */
/**
 * Відкрити екран чату й дочекатися, поки він ОЖИВЕ.
 *
 * `domcontentloaded` означає лише готову розмітку: до гідратації кнопка вже
 * намальована, але обробника ще немає, і дотик по ній не робить нічого.
 * Ознака життя — перший клієнтський запит списку розмов: його робить уже
 * React, а не сервер.
 */
async function openChat(page: Page, path: string) {
  const ready = page.waitForResponse((r) => r.url().includes("/api/chat/conversations") && r.ok(), { timeout: 30_000 });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await ready;
}

async function press(page: Page, target: Locator) {
  const touch = await page.evaluate(() => "ontouchstart" in window || navigator.maxTouchPoints > 0);
  if (touch) await target.tap();
  else await target.click();
}

/**
 * Набрати текст і надіслати його.
 *
 * Пауза між набором і натисканням — не забаганка: `fill()` міняє поле
 * миттєво, а екран проводить кожну літеру через стан батьківського
 * компонента. Натискання в ТОЙ САМИЙ такт ловить кнопку між двома
 * станами, і повідомлення не йде. Палець стільки не встигає — між
 * останньою літерою й кнопкою мінімум пів секунди.
 */
async function sendText(page: Page, text: string) {
  const field = page.getByPlaceholder("Повідомлення…");
  const button = page.getByRole("button", { name: "Надіслати" });
  await field.fill(text);
  await expect(button).toBeEnabled();
  await page.waitForTimeout(300);
  await press(page, button);
  // Поле очистилось — отже екран прийняв відправку, а не проковтнув її.
  await expect(field).toHaveValue("", { timeout: 15_000 });
}

test.describe("чат персоналу", () => {
  test.skip(!USERS, "немає CHAT_E2E_USERS");

  test("особисте доходить до адресата й позначається переглянутим", async ({ browser }) => {
    const salesCtx = await browser.newContext();
    const driverCtx = await browser.newContext();
    await loginAs(salesCtx, USERS!.sales);
    await loginAs(driverCtx, USERS!.driver);
    const dm = dmKey(USERS!.sales.id, USERS!.driver.id);

    const sales: Page = await salesCtx.newPage();
    await openChat(sales, `/sales/chat/${dm}`);
    const text = `${stamp()} привіт з кабінету`;
    await sendText(sales, text);

    await expect(bubble(sales, text)).toBeVisible({ timeout: 15_000 });
    await expect(sales.getByText("Не надіслано")).toHaveCount(0);
    // Поки адресат не відкрив — одна галочка.
    await expect(sales.getByText("Надіслано").first()).toBeVisible({ timeout: 15_000 });

    // Водій відкриває розмову — і бачить те саме повідомлення.
    const driver: Page = await driverCtx.newPage();
    await openChat(driver, `/driver/chat/${dm}`);
    await expect(bubble(driver, text)).toBeVisible({ timeout: 20_000 });

    // …а у відправника галочка стає подвійною (опитування раз на 5 с).
    await expect(sales.getByText("Переглянуто").first()).toBeVisible({ timeout: 30_000 });

    await salesCtx.close();
    await driverCtx.close();
  });

  test("на ноутбуці ліворуч список, праворуч розмова", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAs(ctx, USERS!.sales);
    const page = await ctx.newPage();
    const dm = dmKey(USERS!.sales.id, USERS!.driver.id);

    await openChat(page, `/sales/chat/${dm}`);
    // Перелік розмов лишається на місці, поки відкрита розмова.
    // exact: інакше сюди ж підпадає кнопка «Написати нове повідомлення» в шапці.
    await expect(page.getByRole("link", { name: "Нове повідомлення", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: new RegExp(USERS!.driver.name) })).toBeVisible();
    // …і поле вводу тієї самої розмови поруч.
    await expect(page.getByPlaceholder("Повідомлення…")).toBeVisible();

    await ctx.close();
  });

  test("смайлик лягає в поле", async ({ browser }) => {
    const ctx = await browser.newContext();
    await loginAs(ctx, USERS!.sales);
    const page = await ctx.newPage();
    const dm = dmKey(USERS!.sales.id, USERS!.driver.id);

    await openChat(page, `/sales/chat/${dm}`);
    const field = page.getByPlaceholder("Повідомлення…");
    await field.fill("буду ");
    await press(page, page.getByRole("button", { name: "Смайлики" }));
    await press(page, page.getByRole("button", { name: "Смайлик 👍" }));
    await expect(field).toHaveValue("буду 👍");

    await ctx.close();
  });

  test("кнопка чату з лічильником стоїть у шапці кабінету", async ({ browser }) => {
    const ctx = await browser.newContext();
    await loginAs(ctx, USERS!.sales);
    const page = await ctx.newPage();
    await page.goto("/sales/clients", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /^Чат/ })).toBeVisible({ timeout: 20_000 });
    await ctx.close();
  });
});
