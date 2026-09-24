/**
 * Приймач каналу `expense`: витрати з регістру 1С `Затраты`.
 *
 * Статтю агент несе в кожному рядку, окремого каналу довідника немає: 335
 * статей проти ≈13 тис. рядків, і нова стаття з'являється разом із першою
 * витратою по ній. Розкладку статті (вид, власник) дає класифікатор
 * finance/cost-items.ts — але лише доти, доки її не поправили руками
 * (manualAt): ручне рішення обмін не перетирає.
 *
 * Мітку `syncedAt = now()` бази ставимо всім рядкам батча ПІСЛЯ запису —
 * на ній тримається звірка розпроведених документів (reconcile-expenses.ts),
 * як balanceSyncedAt у боргах. now() саме бази: відсічка звірки береться з
 * SyncBatch.createdAt, тобто з того ж годинника.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { prisma } from "@/lib/prisma";
import { ApplyContext } from "./context";
import type { ExpenseRecord } from "./types";
import { classifyCostItem } from "@/lib/finance/cost-items";

const DOC_TYPES = new Set(["OTHER_COST", "ADVANCE_REPORT", "OTHER"]);

export async function applyExpenses(records: ExpenseRecord[], ctx: ApplyContext): Promise<void> {
  const valid = records.filter((r) => r.externalId && r.costItemExternalId && r.date && Number.isFinite(r.amount));
  ctx.skipped += records.length - valid.length;
  if (valid.length === 0) return;

  /* ── Статті ─────────────────────────────────────────────────────── */
  const itemIds = [...new Set(valid.map((r) => r.costItemExternalId))];
  const [items, reps] = await Promise.all([
    prisma.costItem.findMany({ where: { externalId: { in: itemIds } } }),
    prisma.user.findMany({ where: { role: "SALES" }, select: { id: true, name: true } }),
  ]);
  const itemByExt = new Map(items.map((i) => [i.externalId, i]));

  for (const extId of itemIds) {
    const rec = valid.find((r) => r.costItemExternalId === extId)!;
    const name = rec.costItemName?.trim() || extId;
    const groupName = rec.costGroupName?.trim() || null;
    const found = itemByExt.get(extId);
    const cls = classifyCostItem(name, groupName, reps);

    if (!found) {
      if (ctx.isPreview) continue;
      const created = await prisma.costItem.create({ data: { externalId: extId, name, groupName, ...cls } });
      itemByExt.set(extId, created);
      continue;
    }
    // Назва чи група в 1С змінилась — оновлюємо; розкладку — лише коли її не правили руками.
    const renamed = found.name !== name || found.groupName !== groupName;
    const reclass =
      !found.manualAt &&
      (found.kind !== cls.kind || found.scope !== cls.scope || found.repId !== cls.repId || found.storeName !== cls.storeName);
    if ((renamed || reclass) && !ctx.isPreview) {
      const updated = await prisma.costItem.update({
        where: { id: found.id },
        data: { name, groupName, ...(found.manualAt ? {} : cls), syncedAt: new Date() },
      });
      itemByExt.set(extId, updated);
    }
  }

  /* ── Рядки ──────────────────────────────────────────────────────── */
  const existing = await prisma.expenseEntry.findMany({
    where: { externalId: { in: valid.map((r) => r.externalId) } },
    select: { id: true, externalId: true, amount: true, docDate: true, costItemId: true, docType: true, personName: true, comment: true, department: true },
  });
  const entryByExt = new Map(existing.map((e) => [e.externalId, e]));

  for (const rec of valid) {
    const item = itemByExt.get(rec.costItemExternalId);
    if (!item) {
      // Лише в прев'ю: стаття не створювалась.
      ctx.skipped++;
      continue;
    }
    const data = {
      docExternalId: rec.docExternalId,
      docType: DOC_TYPES.has(rec.docType) ? rec.docType : "OTHER",
      docDate: new Date(rec.date),
      costItemId: item.id,
      amount: rec.amount,
      department: rec.department ?? null,
      personName: rec.personName ?? null,
      comment: rec.comment ?? null,
    };
    const found = entryByExt.get(rec.externalId);
    if (!found) {
      if (!ctx.isPreview) await prisma.expenseEntry.create({ data: { externalId: rec.externalId, ...data } });
      ctx.created++;
      continue;
    }
    const same =
      Math.abs(found.amount - data.amount) < 0.005 &&
      found.docDate.getTime() === data.docDate.getTime() &&
      found.costItemId === data.costItemId &&
      found.docType === data.docType &&
      found.department === data.department &&
      found.personName === data.personName &&
      found.comment === data.comment;
    if (same) {
      ctx.skipped++;
      continue;
    }
    if (!ctx.isPreview) await prisma.expenseEntry.update({ where: { id: found.id }, data });
    ctx.updated++;
  }

  if (!ctx.isPreview) {
    await prisma.$executeRaw`
      UPDATE "ExpenseEntry" SET "syncedAt" = now()
      WHERE "externalId" = ANY(${valid.map((r) => r.externalId)}::text[])
    `;
  }
}
