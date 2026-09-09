/**
 * Чат персоналу в кабінеті: список, розмова, доставка колезі, бейдж.
 *
 * Дві сесії в одному тесті, бо перевіряти тут треба саме зустріч: те, що
 * написав торговий, має за секунди зʼявитися у водія — і зникнути з
 * лічильника непрочитаного, щойно той відкриє розмову.
 *
 * Запуск (сервер уже піднятий):
 *   E2E_NO_SERVER=1 E2E_BASE_URL=http://localhost:3100 \
 *     npx playwright test tests/e2e/staff-chat.spec.ts --project=mobile
 *
 * Потрібні кукі тестових акаунтів у CHAT_E2E_USERS (JSON зі скрипта
 * scripts/_probe-chat-ui.mjs) — інакше тест пропускається.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";

type Who = { id: string; name: string; token: string };
const USERS: Record<string, Who> | null = process.env.CHAT_E2E_USERS
  ? JSON.parse(process.env.CHAT_E2E_USERS)
  : null;

const BASE = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3100");

async function loginAs(context: BrowserContext, who: Who) {
  // Обидва імені: middleware читає __Secure-, клієнтський /api/auth/session — просте.
  await context.addCookies(
    ["next-auth.session-token", "__Secure-next-auth.session-token"].map((name) => ({
      name,
      value: who.token,
      domain: BASE.hostname,
      path: "/",
      httpOnly: true,
      // secure навіть на http: без цього Chrome відкидає кукі з префіксом
      // __Secure- разом з усім набором, а на localhost вона допускається.
      secure: true,
      sameSite: "Lax" as const,
    }))
  );
}

/** Текст із міткою прогону — щоб тест не бачив залишків попереднього. */
const stamp = () => `тест ${Date.now().toString().slice(-6)}`;

test.describe("чат персоналу", () => {
  test.skip(!USERS, "немає CHAT_E2E_USERS");

  test("торговий пише в «Усі», водій це бачить", async ({ browser }) => {
    const salesCtx = await browser.newContext();
    const driverCtx = await browser.newContext();
    await loginAs(salesCtx, USERS!.sales);
    await loginAs(driverCtx, USERS!.driver);

    const sales: Page = await salesCtx.newPage();
    await sales.goto("/sales/chat", { waitUntil: "domcontentloaded" });

    // Список розмов: «Усі» і своя група є, чужих груп немає.
    await expect(sales.getByRole("link", { name: /Усі/ })).toBeVisible();
    await expect(sales.getByText("Торгові", { exact: true })).toBeVisible();
    await expect(sales.getByText("Водії", { exact: true })).toHaveCount(0);

    await sales.getByRole("link", { name: /Усі/ }).first().click();
    const text = `${stamp()} привіт з кабінету`;
    await sales.getByPlaceholder("Повідомлення…").fill(text);
    await sales.getByRole("button", { name: "Надіслати" }).click();
    // Не оптимістичну бульбашку чекаємо, а підтверджену: та зʼявляється
    // одразу і з обірваним запитом теж, тож сама по собі нічого не доводить.
    await expect(sales.getByText(text)).toBeVisible({ timeout: 15_000 });
    await expect(sales.getByText("Не надіслано")).toHaveCount(0);

    // Водій бачить те саме повідомлення в «Усі» — опитування раз на 5 с.
    const driver: Page = await driverCtx.newPage();
    await driver.goto("/driver/chat/all", { waitUntil: "domcontentloaded" });
    await expect(driver.getByText(text)).toBeVisible({ timeout: 20_000 });

    // …і автор підписаний, бо в групі пишуть кілька людей. first(): у стрічці
    // накопичуються повідомлення попередніх прогонів того самого автора.
    await expect(driver.getByText(USERS!.sales.name).first()).toBeVisible();

    await salesCtx.close();
    await driverCtx.close();
  });

  test("особисте видно лише двом", async ({ browser }) => {
    const salesCtx = await browser.newContext();
    const driverCtx = await browser.newContext();
    await loginAs(salesCtx, USERS!.sales);
    await loginAs(driverCtx, USERS!.driver);

    const sales = await salesCtx.newPage();
    await sales.goto("/sales/chat/new", { waitUntil: "domcontentloaded" });
    await sales.getByRole("button", { name: new RegExp(USERS!.driver.name) }).click();
    const text = `${stamp()} особисто водію`;
    await sales.getByPlaceholder("Повідомлення…").fill(text);
    await sales.getByRole("button", { name: "Надіслати" }).click();
    await expect(sales.getByText(text)).toBeVisible({ timeout: 15_000 });
    // Після надсилання ми всередині розмови — адреса стала ключем dm-…
    await expect(sales).toHaveURL(/\/sales\/chat\/dm-/, { timeout: 15_000 });

    // У водія воно в списку, і бейдж непрочитаного світиться.
    const driver = await driverCtx.newPage();
    await driver.goto("/driver/chat", { waitUntil: "domcontentloaded" });
    await expect(driver.getByText(text)).toBeVisible({ timeout: 20_000 });

    await salesCtx.close();
    await driverCtx.close();
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
