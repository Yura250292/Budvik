/**
 * Канал `expense` на справжній (локальній) базі: приймач applyExpenses і
 * звірка reconcileExpenses.
 *
 * Що доводимо:
 * - перший знімок створює статті (з розкладкою класифікатора) і рядки;
 * - той самий знімок удруге нічого не пише;
 * - змінена сума оновлюється;
 * - ручна розкладка статті (manualAt) переживає обмін;
 * - рядок вікна, якого в новому знімку немає (документ розпровели), зникає,
 *   а рядок ДО вікна — лишається;
 * - обірваний знімок (зникло забагато) нічого не стирає;
 * - знімок із counts.expensesFailed не звіряється зовсім.
 *
 *   npx tsx --env-file=.env scripts/check-expense-ingest.mts
 *
 * Пише в базу й прибирає за собою — лише локальна.
 */

import { prisma } from "../src/lib/prisma";
import { ApplyContext } from "../src/lib/sync-ingest/context";
import { applyExpenses } from "../src/lib/sync-ingest/apply-expenses";
import { reconcileExpenses } from "../src/lib/sync-ingest/reconcile-expenses";
import type { ExpenseRecord } from "../src/lib/sync-ingest/types";

const P = `exp-check-${Date.now()}`;
const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${JSON.stringify(got)}`);
  if (!ok) fails.push(name);
}

const rep = await prisma.user.create({ data: { email: `${P}@budvik.local`, name: "Перевірочний Кулик", role: "SALES" } });
const job = await prisma.syncJob.create({ data: { type: "agent-full", status: "running", fileName: `${P}-run` }, select: { id: true } });

let run = 0;
/** Новий «прогін»: SyncBatch з тим самим runId, як його пише приймач батчів. */
async function newRun(records: ExpenseRecord[]) {
  run++;
  const runId = `${P}-run-${run}`;
  const ctx = new ApplyContext(job.id, runId, "full");
  await prisma.syncBatch.create({ data: { id: `${runId}-b1`, runId, seq: 1, entityType: "expense", records: records.length } });
  // Відсічка звірки — час першого батча мінус запас на годинники; щоб тест не
  // чекав п'ять хвилин, «старимо» попередні мітки вручну.
  await prisma.expenseEntry.updateMany({ where: { externalId: { startsWith: P } }, data: { syncedAt: new Date(Date.now() - 3_600_000) } });
  await applyExpenses(records, ctx);
  return ctx;
}

const rec = (doc: string, item: string, amount: number, date = "2026-09-10T12:00:00", name = "Паливо Кулик", group?: string): ExpenseRecord => ({
  externalId: `${P}-${doc}:${P}-${item}`,
  docExternalId: `${P}-${doc}`,
  docType: "OTHER_COST",
  date,
  costItemExternalId: `${P}-${item}`,
  costItemName: name,
  ...(group ? { costGroupName: group } : {}),
  amount,
});

try {
  const base = [
    rec("d1", "fuel", 1500),
    rec("d1", "rent", 20000, "2026-09-10T12:00:00", "Оренда", "DNIPRO M Щирецька"),
    rec("d2", "fuel", 900, "2026-09-15T09:00:00"),
    rec("old", "rent", 18000, "2023-12-20T12:00:00", "Оренда", "DNIPRO M Щирецька"),
  ];

  /* ── Створення ──────────────────────────────────────────────────── */
  const c1 = await newRun(base);
  check("створено 4 рядки", c1.created === 4, { created: c1.created, updated: c1.updated, skipped: c1.skipped });
  const fuel = await prisma.costItem.findUnique({ where: { externalId: `${P}-fuel` } });
  check("стаття «Паливо Кулик» — пальне торгового", fuel?.kind === "FUEL" && fuel?.scope === "REP" && fuel?.repId === rep.id, fuel);
  const rent = await prisma.costItem.findUnique({ where: { externalId: `${P}-rent` } });
  check("оренда в групі магазину — магазин", rent?.kind === "RENT" && rent?.scope === "STORE" && rent?.storeName === "DNIPRO M Щирецька", rent);

  /* ── Повтор без змін ────────────────────────────────────────────── */
  const c2 = await newRun(base);
  check("той самий знімок нічого не пише", c2.created === 0 && c2.updated === 0 && c2.skipped === 4, { created: c2.created, updated: c2.updated, skipped: c2.skipped });

  /* ── Зміна суми ─────────────────────────────────────────────────── */
  const c3 = await newRun([rec("d1", "fuel", 1700), ...base.slice(1)]);
  const e = await prisma.expenseEntry.findUnique({ where: { externalId: `${P}-d1:${P}-fuel` } });
  check("змінена сума оновилась", c3.updated === 1 && e?.amount === 1700, { updated: c3.updated, amount: e?.amount });

  /* ── Ручна розкладка ────────────────────────────────────────────── */
  await prisma.costItem.update({ where: { externalId: `${P}-fuel` }, data: { kind: "OTHER", scope: "COMPANY", repId: null, manualAt: new Date() } });
  await newRun([rec("d1", "fuel", 1700), ...base.slice(1)]);
  const kept = await prisma.costItem.findUnique({ where: { externalId: `${P}-fuel` } });
  check("ручна розкладка переживає обмін", kept?.kind === "OTHER" && kept?.scope === "COMPANY", kept);

  /* ── Звірка: документ d2 розпровели ─────────────────────────────── */
  // Знімок вікна від 2024-01-01 без d2; «old» (2023) лежить до вікна.
  const c5 = await newRun([rec("d1", "fuel", 1700), base[1]]);
  const removed = await reconcileExpenses(c5, { expensesFrom: "2024-01-01" });
  const left = await prisma.expenseEntry.findMany({ where: { externalId: { startsWith: P } }, select: { externalId: true } });
  const ids = left.map((l) => l.externalId.replace(`${P}-`, "").split(":")[0]);
  check("розпроведений d2 зник", removed === 1 && !ids.includes("d2"), { removed, ids });
  check("рядок до вікна лишився", ids.includes("old"), ids);

  /* ── Обірваний знімок нічого не стирає ──────────────────────────── */
  // 10 рядків у вікні, новий знімок приніс один — «зникло» 90 %.
  const many = Array.from({ length: 10 }, (_, i) => rec(`m${i}`, "fuel", 100 + i));
  await newRun([...many, base[1]]);
  const c7 = await newRun([many[0]]);
  const removed2 = await reconcileExpenses(c7, { expensesFrom: "2024-01-01" });
  const stillMany = await prisma.expenseEntry.count({ where: { externalId: { startsWith: `${P}-m` } } });
  check("обірваний знімок нічого не стирає", removed2 === 0 && stillMany === 10, { removed2, stillMany });

  /* ── Впалий запит — без звірки ──────────────────────────────────── */
  const c8 = await newRun([many[0]]);
  const removed3 = await reconcileExpenses(c8, { expensesFrom: "2024-01-01", expensesFailed: "boom" });
  check("counts.expensesFailed — звірки немає", removed3 === 0, removed3);
  const removed4 = await reconcileExpenses(c8, {});
  check("без expensesFrom — звірки немає", removed4 === 0, removed4);
} finally {
  await prisma.expenseEntry.deleteMany({ where: { externalId: { startsWith: P } } });
  await prisma.costItem.deleteMany({ where: { externalId: { startsWith: P } } });
  await prisma.syncBatch.deleteMany({ where: { runId: { startsWith: P } } });
  await prisma.syncJob.delete({ where: { id: job.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: rep.id } }).catch(() => {});
  await prisma.$disconnect();
}

console.log(fails.length ? `\nПровалено: ${fails.length}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
