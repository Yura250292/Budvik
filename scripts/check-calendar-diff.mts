/**
 * Дифф конектора: що вставити, що виправити, а що прибрати з календаря.
 *
 * Це найдорожче місце помилки в усьому конекторі — саме звідси беруться
 * дублі подій і зайві виклики Google. Тому перевіряється окремо і без
 * бази: дифф — чиста функція над двома списками.
 *
 *   npx tsx scripts/check-calendar-diff.mts
 *
 * Бази не торкається, у Google не ходить.
 */

import { planChanges, type Action, type LinkRow } from "../src/lib/calendar/diff";
import { contentHash } from "../src/lib/calendar/render";
import type { DesiredEvent } from "../src/lib/calendar/types";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

const NOW = new Date("2026-09-22T09:00:00Z");

function task(id: string, summary = "Забрати документи"): DesiredEvent {
  return {
    entity: "STAFF_TASK",
    entityId: id,
    summary,
    description: null,
    location: null,
    day: "2026-09-24",
    at: null,
    minutes: null,
  };
}

/** У дії на вставку id події ще немає — для проби це просто «нічого». */
const eventIdOf = (a: Action | undefined): string => (a && a.kind !== "insert" ? a.googleEventId : "");

function link(e: DesiredEvent, over: Partial<LinkRow> = {}): LinkRow {
  return {
    entity: e.entity,
    entityId: e.entityId,
    googleEventId: `bdvk${e.entityId}`,
    contentHash: contentHash(e),
    state: "SYNCED",
    nextAttemptAt: null,
    ...over,
  };
}

/* ── Три основні випадки ────────────────────────────────────────────── */

const a = task("t1");
const fresh = planChanges([a], [], NOW, 25);
check("нової події немає в Google — вставити", fresh.length === 1 && fresh[0].kind === "insert", fresh[0]?.kind);

const same = planChanges([a], [link(a)], NOW, 25);
check("зміст не мінявся — не чіпати", same.length === 0, `дій ${same.length}`);

const changed = planChanges([task("t1", "Інша назва")], [link(a)], NOW, 25);
check("зміст інший — виправити", changed.length === 1 && changed[0].kind === "patch", changed[0]?.kind);
check("виправляємо ту саму подію Google", eventIdOf(changed[0]) === "bdvkt1", eventIdOf(changed[0]));

const gone = planChanges([], [link(a)], NOW, 25);
check("задачі вже немає — прибрати з календаря", gone.length === 1 && gone[0].kind === "delete", gone[0]?.kind);
check("прибираємо за id події", eventIdOf(gone[0]) === "bdvkt1", eventIdOf(gone[0]));

/* ── Повторні спроби ────────────────────────────────────────────────── */

const waiting = planChanges(
  [task("t1", "Інша назва")],
  [link(a, { state: "FAILED", nextAttemptAt: new Date("2026-09-22T09:30:00Z") })],
  NOW,
  25
);
check("до наступної спроби ще рано — пропустити", waiting.length === 0, `дій ${waiting.length}`);

const due = planChanges(
  [task("t1", "Інша назва")],
  [link(a, { state: "FAILED", nextAttemptAt: new Date("2026-09-22T08:30:00Z") })],
  NOW,
  25
);
check("час спроби настав — пробувати знову", due.length === 1 && due[0].kind === "patch", due[0]?.kind);

const pending = planChanges([a], [link(a, { state: "PENDING", googleEventId: "" })], NOW, 25);
check("лінк є, а події ще немає — вставити", pending.length === 1 && pending[0].kind === "insert", pending[0]?.kind);

/* ── Стеля на тік ───────────────────────────────────────────────────── */

const many = Array.from({ length: 40 }, (_, i) => task(`t${i}`));
const capped = planChanges(many, [], NOW, 25);
check("більше стелі за раз не робимо", capped.length === 25, `дій ${capped.length}`);
check("решта дочекається наступного тіку", planChanges(many, [], NOW, 5).length === 5, "5");

/* ── Порядок: спершу прибрати, потім додати ─────────────────────────── */

const mixed = planChanges([task("t2")], [link(a)], NOW, 25);
check("прибирання йде першим", mixed[0]?.kind === "delete", mixed.map((m) => m.kind).join(", "));

/* ── Підсумок ───────────────────────────────────────────────────────── */

console.log();
if (fails.length > 0) {
  console.log(`✖ провалено ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("✔ усе зійшлося");
