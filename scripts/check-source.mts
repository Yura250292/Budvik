/**
 * Перевірка визначення джерела переходу. READ ONLY: у базу не ходимо взагалі.
 *
 * Запуск: npx tsx scripts/check-source.mts
 *
 * Правила, які тут закріплені, коштують грошей: помилка в них означає, що
 * замовлення з Hotline полічиться як «прямий захід», і рішення «платити далі
 * чи вимикати» буде прийматись за хибними числами.
 */

import {
  resolveSource,
  packSource,
  unpackSource,
  type Attribution,
} from "../src/lib/webstats/source";

let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? "✅" : "❌"} ${name}${
      ok ? "" : `\n   маємо: ${JSON.stringify(got)}\n   треба: ${JSON.stringify(want)}`
    }`
  );
}

const HOST = "www.budvik27.com";
const DIRECT = { source: "direct", medium: "none", campaign: null };

console.log("Джерело візиту\n");

eq(
  "мітка з фіду",
  resolveSource("?utm_source=hotline&utm_medium=cpc&utm_campaign=feed", "https://hotline.ua/", HOST),
  { source: "hotline", medium: "cpc", campaign: "feed" }
);

eq("без мітки — за реферером Hotline", resolveSource("", "https://hotline.ua/ua/tovar/123/", HOST), {
  source: "hotline",
  medium: "cpc",
  campaign: null,
});

eq("пошук Google", resolveSource("", "https://www.google.com/search?q=дриль", HOST), {
  source: "google",
  medium: "organic",
  campaign: null,
});

eq("чужий сайт — хостом", resolveSource("", "https://ek.ua/ua/link/", HOST), {
  source: "ek.ua",
  medium: "referral",
  campaign: null,
});

eq("свій сайт — прямий захід", resolveSource("", `https://${HOST}/catalog`, HOST), DIRECT);
eq("без реферера — прямий захід", resolveSource("", null, HOST), DIRECT);
eq("побитий реферер не валить розбір", resolveSource("", "не-адреса", HOST), DIRECT);

eq(
  "сміття в мітці відсікається",
  resolveSource("?utm_source=<script>alert(1)</script>", null, HOST),
  DIRECT
);

eq(
  "мітка обрізається до 40 символів",
  resolveSource(`?utm_source=${"a".repeat(80)}`, null, HOST).source.length,
  40
);

eq(
  "мітка без medium — вважаємо переходом",
  resolveSource("?utm_source=hotline", null, HOST),
  { source: "hotline", medium: "referral", campaign: null }
);

console.log("\nПам'ять на 30 днів\n");

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 22);
const hotline: Attribution = { source: "hotline", medium: "cpc", campaign: "feed" };
const packed = packSource(hotline, now);

eq("пам'ять читається назад", unpackSource(packed, now + 3 * DAY), hotline);
eq("останній день вікна ще діє", unpackSource(packed, now + 30 * DAY - 1), hotline);
eq("через 31 день пам'ять не діє", unpackSource(packed, now + 31 * DAY), null);
eq("побитий рядок не валить код", unpackSource("{зламано", now), null);
eq("порожня пам'ять", unpackSource(null, now), null);
eq("без мітки часу не віримо", unpackSource(JSON.stringify({ s: "hotline" }), now), null);

eq(
  "хост із крапкою переживає пам'ять",
  unpackSource(packSource({ source: "ek.ua", medium: "referral", campaign: null }, now), now),
  { source: "ek.ua", medium: "referral", campaign: null }
);

console.log(failed === 0 ? "\nУсе гаразд." : `\nПомилок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
