/**
 * Проєктор задач і класифікація відповідей Google.
 *
 * Дві речі, від яких залежить, чи не набридне конектор людині: у календар
 * має потрапляти рівно те, що вона сама вважає своїм днем (а не чернетки
 * й закриті задачі), і тимчасовий збій Google не має перетворюватися на
 * «підключіть календар ще раз».
 *
 *   npx tsx scripts/check-calendar-projector.mts
 *
 * Бази не торкається, у Google не ходить.
 */

import { taskEvents, type TaskRow } from "../src/lib/calendar/projectors/tasks";
import { classifyGoogle } from "../src/lib/calendar/errors";
import { kyivDayEnd } from "../src/lib/date/kyiv";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

const WINDOW = { from: "2026-09-21", to: "2026-10-06" };

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task_1",
    title: "Забрати документи в Кунанця",
    details: null,
    status: "ASSIGNED",
    priority: "NORMAL",
    dueAt: kyivDayEnd("2026-09-24"),
    counterpartyName: null,
    ...over,
  };
}

/* ── Що потрапляє в календар ────────────────────────────────────────── */

const ok1 = taskEvents([row()], WINDOW);
check("призначена задача зі строком — подія є", ok1.length === 1, `подій ${ok1.length}`);
check("подія на весь день, київську добу строку", ok1[0]?.day === "2026-09-24", ok1[0]?.day);
check("заголовок — назва задачі", ok1[0]?.summary === "Забрати документи в Кунанця", ok1[0]?.summary);
check("ключ — id задачі", ok1[0]?.entityId === "task_1", ok1[0]?.entityId);
check("сутність названа", ok1[0]?.entity === "STAFF_TASK", ok1[0]?.entity);

check("виконана — події немає", taskEvents([row({ status: "DONE" })], WINDOW).length === 0, "0");
check("скасована — події немає", taskEvents([row({ status: "CANCELLED" })], WINDOW).length === 0, "0");
check("ще не підтверджена офісом — події немає", taskEvents([row({ status: "PROPOSED" })], WINDOW).length === 0, "0");
check("без строку — події немає", taskEvents([row({ dueAt: null })], WINDOW).length === 0, "0");
check("строк далеко попереду — поза вікном", taskEvents([row({ dueAt: kyivDayEnd("2026-12-01") })], WINDOW).length === 0, "0");
check("строк давно минув — поза вікном", taskEvents([row({ dueAt: kyivDayEnd("2026-08-01") })], WINDOW).length === 0, "0");
check("вчорашня прострочена — ще показуємо", taskEvents([row({ dueAt: kyivDayEnd("2026-09-21") })], WINDOW).length === 1, "1");

/* ── Зміст події ────────────────────────────────────────────────────── */

const rich = taskEvents([row({ details: "Договір і накладна за серпень", counterpartyName: "Кунанець ФОП" })], WINDOW)[0];
check("деталі в описі", rich?.description?.includes("Договір і накладна") === true, rich?.description);
check("клієнт в описі", rich?.description?.includes("Кунанець ФОП") === true, rich?.description);
check("важлива задача помічена в заголовку", taskEvents([row({ priority: "HIGH" })], WINDOW)[0]?.summary.startsWith("!"), taskEvents([row({ priority: "HIGH" })], WINDOW)[0]?.summary);

/* ── Відповіді Google ───────────────────────────────────────────────── */

check("токен відкликано — треба перепідключити", classifyGoogle(401, "") === "reconnect", classifyGoogle(401, ""));
check("invalid_grant — треба перепідключити", classifyGoogle(400, '{"error":"invalid_grant"}') === "reconnect", classifyGoogle(400, '{"error":"invalid_grant"}'));
check("перевищено ліміт — пробувати пізніше", classifyGoogle(403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}') === "retry", classifyGoogle(403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}'));
check("забагато запитів — пробувати пізніше", classifyGoogle(429, "") === "retry", classifyGoogle(429, ""));
check("Google зламався — пробувати пізніше", classifyGoogle(503, "") === "retry", classifyGoogle(503, ""));
check("немає прав — не повторювати", classifyGoogle(403, '{"error":{"errors":[{"reason":"insufficientPermissions"}]}}') === "fatal", classifyGoogle(403, '{"error":{"errors":[{"reason":"insufficientPermissions"}]}}'));
check("криве тіло — наш баг, не повторювати", classifyGoogle(400, '{"error":"bad field"}') === "fatal", classifyGoogle(400, '{"error":"bad field"}'));
check("події вже немає — не помилка", classifyGoogle(404, "") === "gone", classifyGoogle(404, ""));
check("подія вже є — не помилка", classifyGoogle(409, "") === "exists", classifyGoogle(409, ""));
check("усе добре", classifyGoogle(200, "") === "ok", classifyGoogle(200, ""));

/* ── Підсумок ───────────────────────────────────────────────────────── */

console.log();
if (fails.length > 0) {
  console.log(`✖ провалено ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("✔ усе зійшлося");
