/**
 * Перевірка страховки запису наради (src/components/meetings/recording-backup.ts)
 * у справжніх рушіях браузера: Chromium і WebKit (Safari).
 *
 * IndexedDB, Web Locks і перезавантаження сторінки в Node не підробиш, тож
 * модуль збирається esbuild-ом і ганяється в Playwright на http://localhost —
 * безпечний контекст, без якого немає navigator.locks.
 *
 *   npx tsx scripts/check-recording-backup.mts
 */

import { build } from "esbuild";
import { chromium, webkit, type BrowserType, type Page } from "playwright";

/* eslint-disable @typescript-eslint/no-explicit-any */

const bundle = await build({
  entryPoints: ["src/components/meetings/recording-backup.ts"],
  bundle: true,
  format: "iife",
  globalName: "RB",
  platform: "browser",
  target: "es2020",
  write: false,
});
const PAGE_URL = "http://localhost/meeting-backup-check";
const HTML = `<!doctype html><html><body><script>${bundle.outputFiles[0].text}</script></body></html>`;

let failures = 0;
function check(engine: string, name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${engine}: ${name}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!ok) failures++;
}

/** Замок відпускається асинхронно — даємо сусідній вкладці кілька спроб. */
async function claimSoon(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      if (await (window as any).RB.claimRecording()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  });
}

const engines: [string, BrowserType][] = [
  ["Chromium", chromium],
  ["WebKit", webkit],
];

for (const [engine, type] of engines) {
  const browser = await type.launch().catch((e: unknown) => {
    check(engine, "браузер запустився (npx playwright install, якщо ні)", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
    return null;
  });
  if (!browser) continue;
  try {
    const context = await browser.newContext();
    await context.route(PAGE_URL, (r) => r.fulfill({ status: 200, contentType: "text/html", body: HTML }));

    const a = await context.newPage();
    await a.goto(PAGE_URL);
    const first = await a.evaluate(async () => {
      const RB = (window as any).RB;
      const claimed = await RB.claimRecording();
      await RB.backupStart({ id: "s1", startedAt: 1000, mimeType: "audio/mp4" });
      for (let i = 0; i < 3; i++) {
        await RB.backupChunk(
          { id: "s1", startedAt: 1000, mimeType: "audio/mp4", elapsedMs: (i + 1) * 3000, updatedAt: Date.now() },
          i,
          new Blob([new Uint8Array(2000).fill(i + 1)])
        );
      }
      const loaded = await RB.backupLoad();
      const bytes = new Uint8Array(await loaded.blob.arrayBuffer());
      return {
        claimed,
        size: loaded.blob.size,
        type: loaded.blob.type,
        elapsed: loaded.meta.elapsedMs,
        order: [bytes[0], bytes[2000], bytes[4000]].join(","),
      };
    });
    check(
      engine,
      "шматки лягають і читаються по порядку",
      first.claimed && first.size === 6000 && first.type === "audio/mp4" && first.elapsed === 9000 && first.order === "1,2,3",
      first
    );

    const b = await context.newPage();
    await b.goto(PAGE_URL);
    const stolen = await b.evaluate(() => (window as any).RB.claimRecording());
    check(engine, "сусідня вкладка не забирає запис, який тримають", stolen === false, stolen);

    await a.reload();
    const afterReload = await a.evaluate(async () => {
      const RB = (window as any).RB;
      const claimed = await RB.claimRecording();
      const loaded = await RB.backupLoad();
      return { claimed, size: loaded ? loaded.blob.size : 0, startedAt: loaded?.meta.startedAt ?? null };
    });
    const reclaimed = afterReload.claimed || (await claimSoon(a));
    check(
      engine,
      "після перезавантаження запис на місці, вкладка знову його тримає",
      reclaimed && afterReload.size === 6000 && afterReload.startedAt === 1000,
      afterReload
    );

    const resurrected = await a.evaluate(async () => {
      const RB = (window as any).RB;
      const late = RB.backupChunk(
        { id: "s1", startedAt: 1000, mimeType: "audio/mp4", elapsedMs: 12000, updatedAt: Date.now() },
        3,
        new Blob([new Uint8Array(5000)])
      );
      const cleared = RB.backupClear();
      await Promise.all([late, cleared]);
      return (await RB.backupLoad()) !== null;
    });
    check(engine, "пізній шматок після стирання не воскрешає запис", resurrected === false, resurrected);

    await a.evaluate(() => (window as any).RB.releaseRecording());
    check(engine, "відпущений запис сусідня вкладка забирає", await claimSoon(b));

    await context.close();
  } catch (e) {
    check(engine, "прогін без винятків", false, e instanceof Error ? e.message : String(e));
  } finally {
    await browser.close();
  }
}

console.log(failures ? `\nНе пройшло перевірок: ${failures}` : "\nУсе пройшло.");
process.exit(failures ? 1 : 0);
