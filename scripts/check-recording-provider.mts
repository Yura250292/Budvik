/**
 * Перевірка запису наради наскрізь у браузері: провайдер
 * (src/components/meetings/MeetingRecordingProvider.tsx) на справжньому
 * MediaRecorder зі штучним мікрофоном Chromium.
 *
 * Те, що 15.09.2026 двічі загубило нараду: зупинений запис зникав після
 * перезавантаження вкладки. Тут перевіряється, що запис переживає
 * перезавантаження і посеред запису, і після «Стоп», що перед виходом
 * браузер питає, і що «Записати заново» справді стирає страховку.
 *
 * Провайдер збирається esbuild-ом разом із React у сторінку-стенд на
 * http://localhost (безпечний контекст — без нього немає мікрофона й Web Locks).
 *
 *   npx tsx scripts/check-recording-provider.mts
 */

import { build } from "esbuild";
import { chromium, type Page } from "playwright";

const HARNESS = `
import { createRoot } from "react-dom/client";
import { MeetingRecordingProvider, useMeetingRecording } from "@/components/meetings/MeetingRecordingProvider";

function Probe() {
  const rec = useMeetingRecording();
  return (
    <div>
      <div
        id="state"
        data-state={rec.state}
        data-supported={String(rec.supported)}
        data-recovered={String(!!rec.recorded?.recovered)}
        data-size={rec.recorded?.blob.size ?? 0}
        data-duration={rec.recorded?.durationMs ?? 0}
        data-error={rec.error ?? ""}
      />
      <button id="start" onClick={() => void rec.start()}>start</button>
      <button id="stop" onClick={rec.stop}>stop</button>
      <button id="reset" onClick={rec.reset}>reset</button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <MeetingRecordingProvider>
    <Probe />
  </MeetingRecordingProvider>
);
`;

const bundle = await build({
  stdin: { contents: HARNESS, loader: "tsx", resolveDir: process.cwd(), sourcefile: "harness.tsx" },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "error",
  write: false,
});

const ORIGIN = "http://localhost";
const PAGE_URL = `${ORIGIN}/recording-check`;
const HTML = `<!doctype html><html><body><div id="root"></div><script src="/recording-check.js"></script></body></html>`;

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!ok) failures++;
}

type Snap = { state: string; recovered: boolean; size: number; duration: number; error: string };

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const d = document.getElementById("state")!.dataset;
    return {
      state: d.state ?? "",
      recovered: d.recovered === "true",
      size: Number(d.size),
      duration: Number(d.duration),
      error: d.error ?? "",
    };
  });
}

async function waitState(page: Page, state: string, timeout = 15_000): Promise<Snap> {
  await page
    .waitForFunction((s) => document.getElementById("state")?.dataset.state === s, state, { timeout })
    .catch(() => {});
  return snap(page);
}

async function chunksInBackup(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("budvik-meeting-recording");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("chunks")) return resolve(0);
          const count = db.transaction("chunks").objectStore("chunks").count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => resolve(-1);
        };
        req.onerror = () => resolve(-1);
      })
  );
}

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
try {
  const context = await browser.newContext();
  await context.grantPermissions(["microphone"], { origin: ORIGIN });
  await context.route(PAGE_URL, (r) => r.fulfill({ status: 200, contentType: "text/html", body: HTML }));
  await context.route(`${ORIGIN}/recording-check.js`, (r) =>
    r.fulfill({ status: 200, contentType: "application/javascript", body: bundle.outputFiles[0].text })
  );

  const page = await context.newPage();
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.accept();
  });
  page.on("pageerror", (e) => console.log("  [сторінка] помилка:", e.message));
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => document.getElementById("state")?.dataset.supported === "true", null, { timeout: 10_000 });

  /* 1. Перезавантаження посеред запису. */
  await page.click("#start");
  let s = await waitState(page, "recording");
  check("запис почався", s.state === "recording", s);
  await page.waitForTimeout(7_500);
  const chunks = await chunksInBackup(page);
  check("шматки вже в страховці посеред запису", chunks >= 2, chunks);

  await page.reload();
  check("перед перезавантаженням посеред запису браузер питав", dialogs === 1, dialogs);
  s = await waitState(page, "stopped");
  check(
    "після перезавантаження посеред запису — підхоплено як зупинений",
    s.state === "stopped" && s.recovered && s.size > 1024 && s.duration >= 3_000,
    s
  );

  /* 2. «Записати заново» стирає страховку. */
  await page.click("#reset");
  s = await waitState(page, "idle");
  await page.waitForTimeout(500);
  check("«Записати заново» — стан порожній і страховка стерта", s.state === "idle" && (await chunksInBackup(page)) === 0, {
    s,
    chunks: await chunksInBackup(page),
  });
  await page.reload();
  await page.waitForTimeout(2_000);
  s = await snap(page);
  check("після стирання й перезавантаження нічого не воскресло", s.state === "idle", s);

  /* 3. «Стоп», потім перезавантаження — те, що губило нараду. */
  const before = dialogs;
  await page.click("#start");
  await waitState(page, "recording");
  await page.waitForTimeout(5_000);
  await page.click("#stop");
  const stopped = await waitState(page, "stopped");
  check("«Стоп» дає зупинений запис із файлом", stopped.state === "stopped" && !stopped.recovered && stopped.size > 1024, stopped);

  await page.waitForTimeout(1_000);
  await page.reload();
  check("перед перезавантаженням зупиненого незбереженого запису браузер питав", dialogs === before + 1, { dialogs, before });
  s = await waitState(page, "stopped");
  check(
    "після «Стоп» і перезавантаження запис на місці",
    s.state === "stopped" && s.recovered && s.size >= stopped.size * 0.9 && Math.abs(s.duration - stopped.duration) < 3_500,
    { recovered: s, original: stopped }
  );

  await page.click("#reset");
  await waitState(page, "idle");
  await context.close();
} catch (e) {
  check("прогін без винятків", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
} finally {
  await browser.close();
}

console.log(failures ? `\nНе пройшло перевірок: ${failures}` : "\nУсе пройшло.");
process.exit(failures ? 1 : 0);
