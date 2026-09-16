/**
 * Хто з контрагентів — свій, а не клієнт: пропозиція для Counterparty.isInternal.
 *
 * READ ONLY за замовчуванням. Без --apply скрипт лише читає (усе в
 * READ ONLY-транзакції, яку база сама не дасть порушити) і друкує таблицю.
 * Nothing is written to the database.
 *
 *   npx tsx --env-file=.env scripts/propose-internal-counterparties.mts
 *   npx tsx --env-file=.env scripts/propose-internal-counterparties.mts --apply
 *   npx tsx --env-file=.env scripts/propose-internal-counterparties.mts --apply --skip id1,id2
 *
 * Навіщо. Евристика в rep-feed/internal.ts упізнає своїх лише за точним
 * збігом відсортованих слів із ім'ям співробітника. «ФОП Кулик Дмитро
 * Михайлович» вона пропускає: «ФОП» і по батькові ламають збіг. А саме такі
 * картки очолюють «втрачених» — перевиписка через ФОП торгового на 1,1 млн
 * виглядала як клієнт, що пішов 31.03.
 *
 * Кандидати:
 *   (a) назва без правової форми (ФОП, ФО-П, ПП, ТОВ, СПД) і без дужок
 *       містить УСІ слова повного (≥ 2 слова) імені співробітника;
 *   (b) картка прив'язана до співробітника через User.counterpartyId;
 *   (c) уже позначені (isInternal) або впізнані позначками в назві —
 *       для повноти картини, --apply їх не чіпає.
 *
 * (a) — пропозиція, а не вирок: «Кулик Дмитро Іванович» може бути справжнім
 * покупцем-тезкою. Тому колонка «зайве» показує слова назви понад ім'я, а
 * хибні збіги виключаються з --apply через --skip.
 *
 * --apply ставить isInternal = true, internalReason = 'staff:<userId>',
 * internalSetAt = now() лише кандидатам (a)/(b), які ще не позначені, і
 * ПЕРЕД цим пише резервну копію scripts/backup-internal-counterparties-<дата>.json
 * (id і попередні значення) — відкат одним UPDATE за нею.
 */

import { existsSync, writeFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { SOURCE_FILTER } from "../src/lib/analytics/facts";
import { isInternalCounterparty } from "../src/lib/rep-feed/internal";
import { kyivDate } from "../src/lib/date/kyiv";

const APPLY = process.argv.includes("--apply");
const skipArg = process.argv.flatMap((a, i, all) => (a === "--skip" && all[i + 1] ? [all[i + 1]] : []));
const SKIP = new Set(skipArg.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean));

const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES", "DRIVER", "WAREHOUSE"];

/** Правові форми й слова, які в назві не є частиною імені. */
const LEGAL_WORDS = new Set([
  "фоп", "фо-п", "спд", "тов", "пп", "фізична", "особа", "підприємець", "особа-підприємець",
]);

/**
 * Латинські літери, які на письмі не відрізнити від кириличних. У 1С їх
 * часом набирають в англійській розкладці посеред слова («Кулuк»). Міняємо
 * лише в словах, де вже є кирилиця, — повністю латинські слова лишаються.
 */
const LOOKALIKE: Record<string, string> = {
  a: "а", c: "с", e: "е", i: "і", o: "о", p: "р", x: "х", y: "у",
  A: "а", B: "в", C: "с", E: "е", H: "н", I: "і", K: "к", M: "м", O: "о", P: "р", T: "т", X: "х", Y: "у",
};

/** Слова імені: без дужок, апострофів, правових форм і однолітерних ініціалів. */
function nameWords(raw: string): string[] {
  const noBrackets = raw.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  // Апостроф у «Дар'я» набирають п'ятьма різними символами — прибираємо всі,
  // щоб «Дарʼя» і «Дар'я» стали одним словом. М'який і твердий знак — туди ж:
  // обліковка «Калашник Дарья» (російською) і картка «ФОП Калашник Дар'я»
  // інакше не зійдуться, а слова по обидва боки нормалізуються однаково.
  const noApostrophes = noBrackets.replace(/['`ʼ’‘ʹ′"ьъЬЪ]/g, "");
  return noApostrophes
    .split(/[^\p{L}-]+/u)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .map((w) => (/[Ѐ-ӿ]/.test(w) ? [...w].map((ch) => LOOKALIKE[ch] ?? ch).join("") : w))
    .map((w) => w.toLowerCase().replace(/ё/g, "е"))
    .filter((w) => w.length > 1 && !LEGAL_WORDS.has(w));
}

type Staff = { id: string; name: string; role: string; counterpartyId: string | null };
type Cp = {
  id: string;
  name: string;
  receivable: number | null;
  isInternal: boolean | null;
  internalReason: string | null;
  internalSetAt: Date | null;
};
type Facts = { id: string; revenue2026: number; lastRealizationAt: Date | null };

type Candidate = {
  cp: Cp;
  source: "a" | "b";
  staff: Staff[];
  extraWords: string[];
};

const hasColumn = async (tx: Prisma.TransactionClient, column: string): Promise<boolean> => {
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Counterparty' AND column_name = ${column}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
};

const read = await prisma.$transaction(
  async (tx) => {
    // Жодного запису в цій транзакції: база відхилить його сама (25006).
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;

    const hasFlag = await hasColumn(tx, "isInternal");

    const staff = await tx.$queryRaw<Staff[]>`
      SELECT u.id, u.name, u.role::text AS role, u."counterpartyId"
      FROM "User" u
      WHERE u.role::text IN (${Prisma.join(STAFF_ROLES)})
      ORDER BY u.name
    `;

    const flagCols = hasFlag
      ? Prisma.sql`c."isInternal", c."internalReason", c."internalSetAt"`
      : Prisma.sql`NULL::boolean AS "isInternal", NULL::text AS "internalReason", NULL::timestamp AS "internalSetAt"`;
    const counterparties = await tx.$queryRaw<Cp[]>`
      SELECT c.id, c.name, c."receivableBalance"::float AS receivable, ${flagCols}
      FROM "Counterparty" c
    `;

    return { hasFlag, staff, counterparties };
  },
  { timeout: 120_000 }
);

const { hasFlag, staff, counterparties } = read;
if (!hasFlag) {
  console.log("⚠ Колонки Counterparty.isInternal у цій базі ще немає (міграцію не накочено): «зараз» показано як «—».");
}

// ── (a) збіг слів імені ─────────────────────────────────────────────────
const staffWords = staff
  .map((s) => ({ s, words: [...new Set(nameWords(s.name))] }))
  .filter((x) => x.words.length >= 2);

const byId = new Map<string, Candidate>();
for (const cp of counterparties) {
  const words = new Set(nameWords(cp.name));
  const matched = staffWords.filter((x) => x.words.every((w) => words.has(w)));
  if (matched.length === 0) continue;
  const used = new Set(matched.flatMap((m) => m.words));
  byId.set(cp.id, {
    cp,
    source: "a",
    staff: matched.map((m) => m.s),
    extraWords: [...words].filter((w) => !used.has(w)),
  });
}

// ── (b) прив'язка User.counterpartyId ───────────────────────────────────
const cpById = new Map(counterparties.map((c) => [c.id, c]));
for (const s of staff) {
  if (!s.counterpartyId) continue;
  const cp = cpById.get(s.counterpartyId);
  if (!cp) continue;
  const existing = byId.get(cp.id);
  if (existing) {
    if (!existing.staff.some((x) => x.id === s.id)) existing.staff.push(s);
    continue;
  }
  byId.set(cp.id, { cp, source: "b", staff: [s], extraWords: [] });
}

// ── (c) уже позначені або з позначкою в назві ───────────────────────────
const noStaff = new Set<string>();
const flagged = counterparties.filter(
  (c) => !byId.has(c.id) && (c.isInternal === true || isInternalCounterparty(c.name, noStaff))
);

// ── Оборот і остання реалізація — лише для тих, кого показуємо ───────────
const shownIds = [...byId.keys(), ...flagged.map((c) => c.id)];
const facts = new Map<string, Facts>();
if (shownIds.length > 0) {
  const rows = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      // SOURCE_FILTER — той самий фільтр, що в КПІ: проведені реалізації й
      // повернення з 1С, нетто. Межа 2026 — календарний рік, не межа аналітики.
      return tx.$queryRaw<Facts[]>`
        SELECT s."counterpartyId" AS id,
               COALESCE(SUM(s."totalAmount") FILTER (
                 WHERE s."createdAt" >= TIMESTAMP '2026-01-01' AND s."createdAt" < TIMESTAMP '2027-01-01'
               ), 0)::float AS "revenue2026",
               MAX(s."createdAt") FILTER (WHERE s."docType" = 'REALIZATION') AS "lastRealizationAt"
        FROM "SalesDocument" s
        WHERE ${SOURCE_FILTER}
          AND s."counterpartyId" IN (${Prisma.join(shownIds)})
        GROUP BY 1
      `;
    },
    { timeout: 120_000 }
  );
  for (const r of rows) facts.set(r.id, r);
}

// ── Друк ─────────────────────────────────────────────────────────────────
const uah = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n).toLocaleString("uk-UA").replace(/ /g, " ");
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pad = (s: string, n: number) => cut(s, n).padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
const flagText = (c: Cp) => (c.isInternal === null ? "—" : c.isInternal ? `так (${c.internalReason ?? "?"})` : "ні");

function header() {
  console.log(
    `  ${pad("контрагент", 46)} ${pad("співробітник", 30)} ${padL("оборот 2026", 12)} ${pad("ост. реаліз.", 12)} ${padL("борг", 10)}  ${pad("зараз", 22)} зайве`
  );
}

function line(c: Cp, staffText: string, extra: string) {
  const f = facts.get(c.id);
  console.log(
    `  ${pad(c.name, 46)} ${pad(staffText, 30)} ${padL(uah(f?.revenue2026 ?? 0), 12)} ${pad(day(f?.lastRealizationAt), 12)} ${padL(uah(c.receivable), 10)}  ${pad(flagText(c), 22)} ${extra}`
  );
  console.log(`    id ${c.id}`);
}

const byRevenue = (a: { cp: Cp }, b: { cp: Cp }) =>
  (facts.get(b.cp.id)?.revenue2026 ?? 0) - (facts.get(a.cp.id)?.revenue2026 ?? 0);

const candidates = [...byId.values()].sort(byRevenue);
const staffLabel = (list: Staff[]) => list.map((s) => `${s.name} [${s.role}]`).join("; ");

console.log(`\nСпівробітників (${STAFF_ROLES.join("/")}): ${staff.length}, з іменем ≥ 2 слова: ${staffWords.length}`);
console.log(`Контрагентів: ${counterparties.length}\n`);

for (const src of ["a", "b"] as const) {
  const list = candidates.filter((c) => c.source === src);
  console.log(
    src === "a"
      ? `(a) назва містить усі слова імені співробітника — ${list.length}`
      : `(b) прив'язані через User.counterpartyId — ${list.length}`
  );
  if (list.length === 0) {
    console.log("  —\n");
    continue;
  }
  header();
  for (const c of list) {
    line(c.cp, staffLabel(c.staff), c.extraWords.join(" ") || "—");
  }
  console.log("");
}

console.log(`(c) уже позначені або з позначкою в назві («Склад …», «(співробітник)» тощо) — ${flagged.length}`);
if (flagged.length > 0) {
  header();
  for (const c of flagged.map((cp) => ({ cp })).sort(byRevenue)) {
    const why = c.cp.isInternal ? "ознака в базі" : "позначка в назві";
    line(c.cp, why, "—");
  }
}

const toApply = candidates.filter((c) => c.cp.isInternal !== true && !SKIP.has(c.cp.id));
const skipped = candidates.filter((c) => SKIP.has(c.cp.id));
console.log(
  `\nДо позначення (--apply): ${toApply.length}` +
    (skipped.length ? `, виключено --skip: ${skipped.length}` : "") +
    `; уже позначених серед (a)/(b): ${candidates.filter((c) => c.cp.isInternal === true).length}`
);

if (!APPLY) {
  console.log("\nREAD ONLY: nothing was written to the database. Перевірте (a) на тезок і запустіть з --apply [--skip id,…].");
  await prisma.$disconnect();
  process.exit(0);
}

// ── --apply ──────────────────────────────────────────────────────────────
if (!hasFlag) {
  console.error("\n✗ --apply неможливий: у базі немає колонки Counterparty.isInternal. Спершу міграція.");
  await prisma.$disconnect();
  process.exit(1);
}
if (toApply.length === 0) {
  console.log("\nНічого позначати.");
  await prisma.$disconnect();
  process.exit(0);
}

const date = kyivDate(new Date());
let backupPath = `scripts/backup-internal-counterparties-${date}.json`;
// Другий прогін того ж дня не має затерти першу копію — саме за нею відкат.
if (existsSync(backupPath)) backupPath = backupPath.replace(".json", `-${Date.now()}.json`);

writeFileSync(
  backupPath,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      note: "Стан ДО --apply. Відкат: UPDATE \"Counterparty\" SET \"isInternal\"=false, \"internalReason\"=<internalReason>, \"internalSetAt\"=<internalSetAt> WHERE id=<id>",
      rows: toApply.map((c) => ({
        id: c.cp.id,
        name: c.cp.name,
        isInternal: c.cp.isInternal,
        internalReason: c.cp.internalReason,
        internalSetAt: c.cp.internalSetAt,
        source: c.source,
        staff: c.staff.map((s) => ({ id: s.id, name: s.name, role: s.role })),
      })),
    },
    null,
    2
  )
);
console.log(`\nРезервна копія: ${backupPath}`);

let updated = 0;
for (const c of toApply) {
  // Причина — перший збіг; повний перелік у резервній копії.
  const reason = `staff:${c.staff[0].id}`;
  updated += await prisma.$executeRaw`
    UPDATE "Counterparty"
    SET "isInternal" = true, "internalReason" = ${reason}, "internalSetAt" = now()
    WHERE id = ${c.cp.id} AND NOT "isInternal"
  `;
}
console.log(`Позначено: ${updated}`);
await prisma.$disconnect();
