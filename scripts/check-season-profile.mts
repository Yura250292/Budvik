/**
 * Сезонний профіль очима людини. READ ONLY.
 *
 * Головну перевірку тут робить ВЛАСНИК, а не код: він дивиться на список
 * груп, відсортований за місяцем піку, і каже «так» або «звідки тут це».
 * Що має зійтися на цьому каталозі: весна — мотокоси, тримери,
 * обприскувачі, малярний; осінь — бензопили, ланцюги, генератори,
 * ліхтарі; рівними мають вийти кріплення, метизи, абразиви. Якщо
 * оснастка до тримерів не встає слідом за тримерами — профіль зламаний.
 *
 *   npx tsx --env-file=.env scripts/check-season-profile.mts
 *   npx tsx --env-file=.env scripts/check-season-profile.mts --force-years=2026
 *
 * `--force-years` рахує профіль на неповному році. Це НЕ режим роботи, а
 * спосіб перевірити саму математику до бекфілу: числа з нього нікуди не
 * записуються й у закупівлю не йдуть.
 *
 * Нічого не пишеться ні в базу сайту, ні тим більше в 1С.
 */

import { prisma } from "@/lib/prisma";
import { buildProfiles, completeYears, type SeasonProfile } from "@/lib/analytics/seasonality";

const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

const args = process.argv.slice(2);
const forced = args.find((a) => a.startsWith("--force-years="))?.split("=")[1];

function bar(index: number[]): string {
  return index.map((v) => (v >= 1.5 ? "█" : v >= 1.15 ? "▆" : v >= 0.85 ? "▃" : v >= 0.5 ? "▁" : "·")).join("");
}

function peak(index: number[]): number {
  return index.indexOf(Math.max(...index));
}

function show(title: string, rows: SeasonProfile[], limit = 20) {
  console.log(`\n=== ${title} ===`);
  if (rows.length === 0) {
    console.log("порожньо");
    return;
  }
  console.log("група                          сн лт бр кв тр чр лп ср вр жв лс гр  пік    ампл  згода  док.");
  for (const r of rows.slice(0, limit)) {
    const name = (r.label || r.key).slice(0, 28).padEnd(30);
    const idx = r.level === "TYPE" ? r.qtyIndex : r.amountIndex;
    console.log(
      `${name}${bar(idx)}  ${MONTHS[peak(idx)].padEnd(6)} ` +
        `${r.amplitude.toFixed(1).padStart(5)} ` +
        `${(r.yearAgreement == null ? "—" : r.yearAgreement.toFixed(2)).padStart(6)} ` +
        `${String(r.docs).padStart(5)}  ${r.confidence}${r.lumpy ? " ⚠ на одному документі" : ""}`
    );
  }
}

async function main() {
  const { years, note } = await completeYears();
  console.log(`Повні роки: ${years.length ? years.join(", ") : "жодного"} (${note})`);

  const useYears = forced ? forced.split(",").map(Number) : years;
  if (useYears.length === 0) {
    console.log("\nСезонність рахувати ще нема на чому: потрібен щонайменше один ПОВНИЙ рік.");
    console.log("Після бекфілу 2024–2025 прожени цей скрипт ще раз.");
    console.log("Щоб перевірити саму математику вже зараз: --force-years=2026");
    return;
  }
  if (forced) {
    console.log(`\n⚠ Рахую на роках ${useYears.join(", ")} примусово — рік може бути неповним.`);
    console.log("   Це перевірка математики, а не робочий профіль.\n");
  }

  const types = await buildProfiles("TYPE", useYears);
  const sections = await buildProfiles("SECTION", useYears);

  // Найвиразніші — ті, де є що показати; рівні групи так само важливі,
  // бо саме вони доводять, що індекс не малює сезон на рівному місці.
  const seasonal = [...types].filter((t) => t.docs >= 30).sort((a, b) => b.amplitude - a.amplitude);
  const flat = [...types].filter((t) => t.docs >= 30).sort((a, b) => a.amplitude - b.amplitude);

  show("Розділи", sections, 25);
  show("Найвиразніший сезон (групи)", seasonal, 20);
  show("Найрівніші групи — тут сезону бути НЕ має", flat, 10);

  console.log("\n=== За місяцем піку ===");
  const byPeak = new Map<number, string[]>();
  for (const t of seasonal) {
    const m = peak(t.qtyIndex);
    if (!byPeak.has(m)) byPeak.set(m, []);
    byPeak.get(m)!.push(t.label || t.key);
  }
  for (let m = 0; m < 12; m++) {
    const list = byPeak.get(m);
    if (list?.length) console.log(`${MONTHS[m]}: ${list.slice(0, 8).join(", ")}`);
  }

  const high = types.filter((t) => t.confidence === "HIGH").length;
  console.log(`\nГруп усього ${types.length}, з них високої довіри ${high} — саме вони можуть рухати закупівлю.`);
  console.log("\nREAD ONLY: nothing was written.");
}

main().finally(() => prisma.$disconnect());
