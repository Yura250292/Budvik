/**
 * Перевірка розбору телефонів із 1С (src/lib/phone.ts).
 *
 * Поле телефону клієнта в 1С — не номер, а рядок, як його набрали: кілька
 * номерів через кому чи ім'я, міський упереміш із мобільним, «доб. 12»,
 * старий префікс «8». На цьому розборі стоїть primaryPhoneE164 — номер, на
 * який торговий пише у Viber, — тож помилка тут означає повідомлення на
 * міський або «номера немає» в клієнта, який його має.
 *
 *   npx tsx scripts/check-phone-normalize.mts            # лише таблиця кейсів, без бази
 *   npx tsx --env-file=.env scripts/check-phone-normalize.mts --live
 *
 * --live — READ ONLY: один SELECT по Counterparty.phone, нічого не пише.
 * Показує, скільки клієнтів отримають мобільний E.164, у скількох лише
 * міський і в скількох номер не розпізнано зовсім (зі зразками — саме з них
 * видно, яких кейсів бракує в таблиці нижче).
 *
 * Падає (код 1), якщо хоч один кейс ✗.
 */
import {
  firstValidE164,
  isUaMobile,
  parsePhones,
  primaryMobileE164,
} from "../src/lib/phone.ts";

type Case = {
  raw: string;
  /** e164 кожного номера в рядку, по порядку; null — шматок не розпізнано. */
  numbers: (string | null)[];
  /** Номер для Viber/SMS — перший мобільний. */
  primary: string | null;
  /** Перший валідний український — мобільний чи міський. */
  first: string | null;
};

const M1 = "+380671234567";
const M2 = "+380501112233";

const CASES: Case[] = [
  { raw: "0671234567", numbers: [M1], primary: M1, first: M1 },
  { raw: "380671234567", numbers: [M1], primary: M1, first: M1 },
  { raw: "+38 (067) 123-45-67", numbers: [M1], primary: M1, first: M1 },
  { raw: "067-123-45-67, 050 111 22 33", numbers: [M1, M2], primary: M1, first: M1 },
  { raw: "0671234567/0501112233", numbers: [M1, M2], primary: M1, first: M1 },
  { raw: "0671234567 0501112233", numbers: [M1, M2], primary: M1, first: M1 },
  // Міський: дзвонити можна, Viber — ні. Внутрішній номер не частина телефону.
  {
    raw: "(032) 245-12-34 доб. 12",
    numbers: ["+380322451234"],
    primary: null,
    first: "+380322451234",
  },
  { raw: "2345678", numbers: [null], primary: null, first: null },
  // Без нуля, як інколи диктують: «67 123 45 67».
  { raw: "671234567", numbers: [M1], primary: M1, first: M1 },
  // Дев'ять цифр із нулем попереду — десятизначний номер, що загубив цифру,
  // а не «без нуля». Раніше ставав неіснуючим міським «+380095497739».
  { raw: "(095497739)", numbers: [null], primary: null, first: null },
  // Дев'ять цифр без нуля — міський Львова без нуля й коду країни.
  { raw: "322935040", numbers: ["+380322935040"], primary: null, first: "+380322935040" },
  // Старий міжміський префікс «8» без трійки.
  { raw: "80671234567", numbers: [M1], primary: M1, first: M1 },
  // Польський мобільний — не український, для нашого Viber-каналу його немає.
  { raw: "+48 600 100 200", numbers: [null], primary: null, first: null },

  // --- рядки, як вони лежать у живому вивантаженні 1С (contacts.ndjson, 25.08) ---
  // Номери розділені іменами, а не комою.
  {
    raw: "098 6267 213 Василь 063 3491 021 Василь адмін",
    numbers: ["+380986267213", "+380633491021"],
    primary: "+380986267213",
    first: "+380986267213",
  },
  {
    raw: "050-66-52-668 Уляна  050-672-60-85 Роман",
    numbers: ["+380506652668", "+380506726085"],
    primary: "+380506652668",
    first: "+380506652668",
  },
  // Міський першим: для Viber має виграти мобільний, а не порядок у полі.
  {
    raw: "(032) 245-12-34, 067 123 45 67",
    numbers: ["+380322451234", M1],
    primary: M1,
    first: "+380322451234",
  },
  // Два номери впритул у різному записі — 12 і 10 цифр.
  { raw: "380671234567 0501112233", numbers: [M1, M2], primary: M1, first: M1 },
  { raw: "", numbers: [], primary: null, first: null },
];

let failed = 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("Розбір телефонів");
for (const c of CASES) {
  const parsed = parsePhones(c.raw);
  const numbers = parsed.map((p) => p.e164);
  const primary = primaryMobileE164(c.raw);
  const first = firstValidE164(c.raw);
  const good = same(numbers, c.numbers) && primary === c.primary && first === c.first;
  if (good) {
    console.log(`  ✓ ${JSON.stringify(c.raw)}`);
  } else {
    failed++;
    console.log(`  ✗ ${JSON.stringify(c.raw)}`, {
      numbers: { got: numbers, want: c.numbers },
      primary: { got: primary, want: c.primary },
      first: { got: first, want: c.first },
      parts: parsed.map((p) => p.raw),
    });
  }
}

console.log("\nМобільний проти міського");
for (const [e164, want] of [
  ["+380671234567", true],
  ["+380391234567", true],
  ["+380322451234", false],
  ["+38067123456", false],
  ["0671234567", false],
] as const) {
  const got = isUaMobile(e164);
  if (got === want) console.log(`  ✓ isUaMobile(${e164}) = ${want}`);
  else {
    failed++;
    console.log(`  ✗ isUaMobile(${e164}) = ${got}, очікували ${want}`);
  }
}

if (process.argv.includes("--live")) {
  await live();
}

console.log(failed ? `\n${failed} перевірок не зійшлося.` : "\nУсе зійшлося.");
process.exit(failed ? 1 : 0);

/**
 * Розподіл по живих картках. Лише читання: один findMany і підрахунок у
 * пам'яті. Prisma імпортується тут, а не зверху, щоб таблиця кейсів
 * ганялась без бази взагалі.
 */
async function live() {
  const { prisma } = await import("../src/lib/prisma.ts");
  console.log("\n--live (READ ONLY): Counterparty.phone");

  // Лише phone: primaryPhoneE164 з'являється міграцією 20260916100000, і
  // на базі, куди її ще не накотили, вибірка цієї колонки валить скрипт.
  const rows = await prisma.counterparty.findMany({
    where: { phone: { not: null } },
    select: { phone: true },
  });

  let empty = 0;
  let mobile = 0;
  let landlineOnly = 0;
  let nothing = 0;
  let multi = 0;
  const unparsed: string[] = [];
  const landline: string[] = [];

  for (const r of rows) {
    const raw = r.phone ?? "";
    if (!raw.trim()) {
      empty++;
      continue;
    }
    const parsed = parsePhones(raw);
    if (parsed.filter((p) => p.e164).length >= 2) multi++;
    if (parsed.some((p) => p.mobile)) mobile++;
    else if (parsed.some((p) => p.e164)) {
      landlineOnly++;
      if (landline.length < 10) landline.push(raw);
    } else {
      nothing++;
      if (unparsed.length < 25) unparsed.push(raw);
    }
  }

  const total = rows.length - empty;
  const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "—");
  console.log(`  карток із непорожнім телефоном: ${total} (порожній рядок: ${empty})`);
  console.log(`  отримають мобільний E.164:      ${mobile} (${pct(mobile)})`);
  console.log(`  лише міський:                   ${landlineOnly} (${pct(landlineOnly)})`);
  console.log(`  номер не розпізнано:            ${nothing} (${pct(nothing)})`);
  console.log(`  два й більше номерів у полі:    ${multi}`);
  if (landline.length) {
    console.log("\n  зразки «лише міський»:");
    for (const s of landline) console.log(`    ${JSON.stringify(s)}`);
  }
  if (unparsed.length) {
    console.log("\n  зразки «не розпізнано»:");
    for (const s of unparsed) console.log(`    ${JSON.stringify(s)}`);
  }
  await prisma.$disconnect();
}
