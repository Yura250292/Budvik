/**
 * Перевірка «людина чи бот» у вебаналітиці без браузера й без бази.
 *
 *   npx tsx scripts/check-human-signals.mts
 *
 * Випадки ботів узято з живої хвилі 01–13.09.2026: 1657 сесій — одне
 * завантаження сторінки й нуль секунд; ще 4 — та сама сторінка вдруге
 * через 11–12 секунд. Падає (код 1), якщо хоч один рядок ✗.
 */
import { humanVerdict, isAutomated, type HumanSignals } from "../src/lib/webstats/human";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

const base: HumanSignals = { visibleMs: 0, input: false, distinctPaths: 1, automated: false };
const verdict = (s: Partial<HumanSignals>) => humanVerdict({ ...base, ...s });

// ---- боти з хвилі 01–13.09 ----
check("бот: завантажив і пішов", verdict({ visibleMs: 800 }) === null, verdict({ visibleMs: 800 }));
check(
  "бот: та сама сторінка вдруге через 12 с",
  verdict({ visibleMs: 12_000, distinctPaths: 1 }) === null,
  verdict({ visibleMs: 12_000, distinctPaths: 1 })
);
check("бот: тримає сторінку 25 с без руху", verdict({ visibleMs: 25_000 }) === null, verdict({ visibleMs: 25_000 }));
check(
  "бот-автомат: рух і довга затримка не рятують",
  verdict({ visibleMs: 60_000, input: true, distinctPaths: 3, automated: true }) === null,
  verdict({ visibleMs: 60_000, input: true, distinctPaths: 3, automated: true })
);

// ---- люди ----
check("людина: гортає картку 8 с", verdict({ visibleMs: 8_000, input: true }) === "input", verdict({ visibleMs: 8_000, input: true }));
check(
  "людина: перейшла на іншу сторінку через 4 с",
  verdict({ visibleMs: 4_000, distinctPaths: 2 }) === "nav",
  verdict({ visibleMs: 4_000, distinctPaths: 2 })
);
check("людина: читає 35 с, не торкаючись", verdict({ visibleMs: 35_000 }) === "dwell", verdict({ visibleMs: 35_000 }));
check(
  "введення важливіше за затримку",
  verdict({ visibleMs: 40_000, input: true, distinctPaths: 2 }) === "input",
  verdict({ visibleMs: 40_000, input: true, distinctPaths: 2 })
);

// ---- межі ----
check("рух за 1 с і пішов — ще не доказ", verdict({ visibleMs: 1_000, input: true }) === null, verdict({ visibleMs: 1_000, input: true }));
check("рівно 3 с з рухом — людина", verdict({ visibleMs: 3_000, input: true }) === "input", verdict({ visibleMs: 3_000, input: true }));
check("29,9 с без руху — ще ні", verdict({ visibleMs: 29_900 }) === null, verdict({ visibleMs: 29_900 }));
check("30 с без руху — так", verdict({ visibleMs: 30_000 }) === "dwell", verdict({ visibleMs: 30_000 }));

// ---- ознаки автоматизації ----
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36 Instagram 345.0";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1";
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";

const human = { webdriver: false, languages: 2, userAgent: DESKTOP_CHROME, hasChromeObject: true };
check("звичайний Chrome на комп'ютері — не автомат", isAutomated(human) === false);
check("navigator.webdriver — автомат", isAutomated({ ...human, webdriver: true }) === true);
check("порожній список мов — автомат", isAutomated({ ...human, languages: 0 }) === true);
check("Chrome на комп'ютері без window.chrome — автомат", isAutomated({ ...human, hasChromeObject: false }) === true);
check(
  "Instagram усередині Android (WebView) без window.chrome — людина",
  isAutomated({ ...human, userAgent: ANDROID_WEBVIEW, hasChromeObject: false }) === false
);
check("Chrome на iPhone без window.chrome — людина", isAutomated({ ...human, userAgent: IOS_CHROME, hasChromeObject: false }) === false);
check("Samsung Internet без window.chrome — людина", isAutomated({ ...human, userAgent: SAMSUNG, hasChromeObject: false }) === false);
check("Firefox без window.chrome — людина", isAutomated({ ...human, userAgent: FIREFOX, hasChromeObject: false }) === false);

console.log(failed ? `\n✗ помилок: ${failed}` : "\n✓ усе гаразд");
process.exit(failed ? 1 : 0);
