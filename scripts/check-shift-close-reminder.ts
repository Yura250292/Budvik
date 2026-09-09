/**
 * Перевірка денних нагадувань «закрий зміну».
 *
 * Таблиця рішень без бази (основний режим):
 *   npx tsx --env-file=.env scripts/check-shift-close-reminder.ts
 *
 * Живі відкриті зміни, БЕЗ запису й без пушів:
 *   npx tsx --env-file=.env scripts/check-shift-close-reminder.ts --dry
 *   npx tsx --env-file=.env scripts/check-shift-close-reminder.ts --dry --at 18:30
 *
 * Справжній прохід (шле пуші й ставить мітки — локальний .env дивиться в
 * бойову базу, тож лише свідомо):
 *   npx tsx --env-file=.env scripts/check-shift-close-reminder.ts --send
 *
 * Помилка тут коштує довіри до каналу: зайвий пуш увечері поверх локальних
 * нагадувань — і людина вимикає сповіщення назавжди, разом із сигналом
 * «підніми трек».
 */
import { PrismaClient } from "@prisma/client";
import { kyivDate, kyivDayStart, kyivTime } from "../src/lib/date/kyiv";
import {
  decideReminder,
  remindUnclosedShifts,
  MIN_STAGE_GAP_MINUTES,
  STANDING_MINUTES,
  type ReminderInput,
} from "../src/lib/shift/close-reminder";

const p = new PrismaClient();
const has = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

/** Типовий стан: зміна з ранку, планшет живий, ще нічого не слали. */
const base: ReminderInput = {
  hour: 15,
  hoursOpen: 7,
  silentMin: 2,
  standingMin: null,
  sentStage: 0,
  minutesSinceSent: null,
};

const cases: Array<{ name: string; input: Partial<ReminderInput>; want: 1 | 2 | null }> = [
  { name: "14:xx — ще рано, хай навіть стоїть", input: { hour: 14, standingMin: 90 }, want: null },
  { name: "15:xx стоїть 90 хв → етап 1", input: { standingMin: 90 }, want: 1 },
  { name: "15:xx їде → мовчимо", input: {}, want: null },
  { name: "15:xx трек мовчить 75 хв → етап 1", input: { silentMin: 75 }, want: 1 },
  { name: "15:xx жодної точки за зміну → етап 1", input: { silentMin: Infinity }, want: 1 },
  {
    name: "15:xx тиша 35 хв — буфер відстає, не судимо",
    input: { silentMin: 35, standingMin: 90 },
    want: null,
  },
  { name: "15:xx зміна відкрита 2,5 год → зарано", input: { hoursOpen: 2.5, standingMin: 90 }, want: null },
  { name: "15:xx стоїть 45 хв — коротше за поріг", input: { standingMin: 45 }, want: null },
  { name: "16:xx після етапу 1 → тиша до 18:00", input: { hour: 16, standingMin: 120, sentStage: 1, minutesSinceSent: 60 }, want: null },
  {
    name: "18:xx після етапу 1 і 3 год → етап 2",
    input: { hour: 18, standingMin: 120, sentStage: 1, minutesSinceSent: 180 },
    want: 2,
  },
  { name: "18:xx етап 1 пропущено (їхав) → один пуш, етап 2", input: { hour: 18, standingMin: 120 }, want: 2 },
  {
    name: "18:xx через 15 хв після етапу 1 → не повторюємо",
    input: { hour: 18, hoursOpen: 3.2, standingMin: 60, sentStage: 1, minutesSinceSent: 15 },
    want: null,
  },
  { name: "18:xx поїхав знову → мовчимо", input: { hour: 18, sentStage: 1, minutesSinceSent: 180 }, want: null },
  {
    name: "19:xx стоїть, етап 1 давно → етап 2 (вікно ще наше)",
    input: { hour: 19, standingMin: 120, sentStage: 1, minutesSinceSent: 180 },
    want: 2,
  },
  { name: "20:xx — далі автозакриття, не наша справа", input: { hour: 20, standingMin: 120 }, want: null },
  { name: "02:xx нічна зміна — правило overdue в автозакритті", input: { hour: 2, hoursOpen: 8, standingMin: 200 }, want: null },
  {
    name: "18:xx обидва етапи вже були → більше ніколи",
    input: { hour: 18, standingMin: 200, sentStage: 2, minutesSinceSent: 200 },
    want: null,
  },
];

function pureTable(): void {
  console.log("Рішення без бази\n" + "─".repeat(72));
  for (const c of cases) {
    const input = { ...base, ...c.input };
    const got = decideReminder(input);
    check(`${c.name} → ${got.stage ?? "—"} (${got.reason})`, got.stage === c.want, {
      want: c.want,
      got: got.stage,
    });
  }

  // Проміжок між етапами — окремо, бо саме він закриває діру «два пуші за чверть години».
  const gap = decideReminder({
    ...base,
    hour: 18,
    standingMin: 90,
    sentStage: 1,
    minutesSinceSent: MIN_STAGE_GAP_MINUTES - 1,
  });
  check(`проміжок рівно ${MIN_STAGE_GAP_MINUTES} хв іще не настав`, gap.stage === null, gap);
  const gapOk = decideReminder({
    ...base,
    hour: 18,
    standingMin: 90,
    sentStage: 1,
    minutesSinceSent: MIN_STAGE_GAP_MINUTES,
  });
  check(`рівно ${MIN_STAGE_GAP_MINUTES} хв — можна`, gapOk.stage === 2, gapOk);
  const edge = decideReminder({ ...base, standingMin: STANDING_MINUTES });
  check(`рівно ${STANDING_MINUTES} хв стоянки — можна`, edge.stage === 1, edge);
}

/**
 * Момент сьогоднішньої київської доби. Через `kyivDayStart`, а не через
 * зашитий «+03:00»: узимку зсув інший, і перевірка мовчки міряла б не ту годину.
 */
function kyivMoment(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(kyivDayStart(kyivDate(new Date())).getTime() + h * 3_600_000 + (m || 0) * 60_000);
}

async function live(send: boolean): Promise<void> {
  const at = arg("at");
  const now = at ? kyivMoment(at) : new Date();
  console.log(
    `\n${send ? "СПРАВЖНІЙ прохід" : "Сухий прохід"} на ${kyivTime(now)} за Києвом\n` + "─".repeat(72)
  );

  const open = await p.shift.count({ where: { status: "OPEN" } });
  console.log(`Відкритих змін у базі: ${open}`);

  const decisions = await remindUnclosedShifts(now, { dryRun: !send });
  if (decisions.length === 0) {
    console.log("Жодної зміни в розгляді (поза вікном 15:00–20:00 або всі свіжі).");
    return;
  }
  for (const d of decisions) {
    const mark = d.send ? `→ ПУШ етап ${d.stage}` : "—";
    const last = d.lastPointAt ? kyivTime(d.lastPointAt) : "точок немає";
    console.log(
      `${(d.name ?? d.userId).padEnd(22)} з ${kyivTime(d.startedAt)}, остання точка ${last.padEnd(12)} ${mark}  ${d.reason}`
    );
  }
  if (!send) console.log("\nНічого не надіслано й не записано.");
}

async function main(): Promise<void> {
  const wantsLive = has("dry") || has("send");
  if (!wantsLive) pureTable();
  else await live(has("send"));

  if (!wantsLive) {
    console.log("─".repeat(72));
    console.log(failed === 0 ? "Усі випадки пройшли." : `Не пройшло: ${failed}`);
  }
  await p.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

void main();
