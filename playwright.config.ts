/**
 * Наскрізні перевірки вітрини.
 *
 * Дев-сервер не піднімаємо примусово: reuseExistingServer підхоплює той, що
 * вже крутиться на 3000, і тільки якщо його немає — стартує свій. Інакше
 * кожен запуск тестів чекав би на повну перезбірку Next.
 */

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      // Той самий chromium, але розміром телефона: ставити ще й webkit заради
      // сітки в одну колонку — платити гігабайтом за перевірку CSS.
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  /*
   * Дев-сервер піднімаємо лише коли його немає.
   *
   * У репозиторії паралельно працює кілька сесій, і сервер на :3000 у них
   * спільний. Коли він зайнятий чужою збіркою, перевірка живості не встигає
   * відповісти, Playwright вирішує, що сервера немає, і запускає свій — а
   * той падає об .next/dev/lock, бо next dev може бути лише один. Тому:
   * E2E_NO_SERVER=1 — «сервер уже піднятий, не чіпай».
   */
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 240_000,
      },
});
