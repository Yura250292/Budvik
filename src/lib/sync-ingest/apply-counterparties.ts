/**
 * Контрагенти з 1С і сальдо взаєморозрахунків.
 *
 * Драбина зіставлення: externalId → code (код 1С) → назва. Як і з товарами,
 * перший збіг дозаписує externalId і надалі контрагент прив'язаний до GUID.
 *
 * Поля доставки (deliveryAddress, координати, contactPerson) — власність сайту:
 * їх заповнює логістика, і 1С про них нічого не знає. Синхронізація їх не чіпає.
 */

import { prisma } from "@/lib/prisma";
import type { CounterpartyType } from "@prisma/client";
import type { CounterpartyRecord, DebtRecord } from "./types";
import { ApplyContext } from "./context";

export async function applyCounterparties(
  records: CounterpartyRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  const codes = records.map((r) => r.code).filter((c): c is string => !!c);
  const names = records.map((r) => r.name.toLowerCase());

  const candidates = await prisma.counterparty.findMany({
    where: {
      OR: [
        { externalId: { in: records.map((r) => r.externalId) } },
        ...(codes.length > 0 ? [{ code: { in: codes } }] : []),
        { name: { in: names, mode: "insensitive" as const } },
      ],
    },
    select: {
      id: true,
      externalId: true,
      code: true,
      name: true,
      phone: true,
      email: true,
      address: true,
    },
  });

  const byExternalId = new Map(
    candidates.filter((c) => c.externalId).map((c) => [c.externalId!, c])
  );
  const byCode = new Map(candidates.filter((c) => c.code).map((c) => [c.code!, c]));
  const byName = new Map(candidates.map((c) => [c.name.toLowerCase(), c]));

  const takenCodes = new Set(candidates.filter((c) => c.code).map((c) => c.code!));

  for (const rec of records) {
    if (!rec.name?.trim()) {
      ctx.skipped++;
      continue;
    }

    const existing =
      byExternalId.get(rec.externalId) ||
      (rec.code ? byCode.get(rec.code) : undefined) ||
      byName.get(rec.name.toLowerCase());

    if (rec.deleted) {
      if (existing) {
        ctx.discrepancy({
          entityType: "counterparty",
          entityRef: existing.code || rec.externalId,
          entityName: rec.name,
          field: "DELETED_IN_1C",
          value1C: "помічено на видалення",
          valueBudvik: "активний на сайті",
        });
      }
      ctx.skipped++;
      continue;
    }

    // --- Новий контрагент ---
    if (!existing) {
      if (ctx.isPreview) {
        ctx.created++;
        ctx.discrepancy({
          entityType: "counterparty",
          entityRef: rec.code || rec.externalId,
          entityName: rec.name,
          field: "NEW",
          value1C: rec.name,
          valueBudvik: "не існує",
        });
        continue;
      }

      // Код 1С унікальний у схемі: якщо він уже зайнятий іншим контрагентом,
      // краще створити без коду, ніж завалити весь батч.
      const code = rec.code && !takenCodes.has(rec.code) ? rec.code : null;
      if (code) takenCodes.add(code);

      try {
        const created = await prisma.counterparty.create({
          data: {
            externalId: rec.externalId,
            name: rec.name,
            code,
            type: (rec.type as CounterpartyType) || "BOTH",
            phone: rec.phone || null,
            email: rec.email || null,
            address: rec.address || null,
          },
          select: { id: true, externalId: true, code: true, name: true, phone: true, email: true, address: true },
        });
        byExternalId.set(rec.externalId, created);
        ctx.created++;
      } catch (e) {
        ctx.fail(rec.name, e);
      }
      continue;
    }

    // --- Наявний контрагент ---
    const updates: Record<string, unknown> = {};

    if (!existing.externalId) updates.externalId = rec.externalId;
    if (!existing.code && rec.code && !takenCodes.has(rec.code)) {
      updates.code = rec.code;
      takenCodes.add(rec.code);
    }
    if (rec.name !== existing.name) updates.name = rec.name;
    // Контакти лише доповнюємо: порожнє значення з 1С не має стирати те,
    // що менеджер вніс вручну.
    if (rec.phone?.trim() && !existing.phone) updates.phone = rec.phone.trim();
    if (rec.email?.trim() && !existing.email) updates.email = rec.email.trim();
    if (rec.address?.trim() && !existing.address) updates.address = rec.address.trim();

    if (Object.keys(updates).length === 0) {
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      ctx.updated++;
      continue;
    }

    try {
      await prisma.counterparty.update({ where: { id: existing.id }, data: updates });
      ctx.updated++;
    } catch (e) {
      ctx.fail(rec.name, e);
    }
  }
}

/** Сальдо дебіторки по контрагентах. Пише лише довідкові поля. */
export async function applyDebts(records: DebtRecord[], ctx: ApplyContext): Promise<void> {
  if (records.length === 0) return;

  const counterparties = await prisma.counterparty.findMany({
    where: { externalId: { in: records.map((r) => r.externalId) } },
    select: { id: true, externalId: true, code: true, name: true, receivableBalance: true },
  });
  const byExternalId = new Map(counterparties.map((c) => [c.externalId!, c]));

  for (const rec of records) {
    const cp = byExternalId.get(rec.externalId);
    if (!cp) {
      ctx.skipped++;
      continue;
    }

    const balance = Number.isFinite(rec.balance) ? rec.balance : 0;

    if (Math.abs((cp.receivableBalance ?? 0) - balance) < 0.01) {
      ctx.skipped++;
      continue;
    }

    ctx.discrepancy({
      entityType: "counterparty",
      entityRef: cp.code || rec.externalId,
      entityName: cp.name,
      field: "receivableBalance",
      value1C: balance.toFixed(2),
      valueBudvik: (cp.receivableBalance ?? 0).toFixed(2),
    });

    if (ctx.isPreview) {
      ctx.updated++;
      continue;
    }

    try {
      await prisma.counterparty.update({
        where: { id: cp.id },
        data: { receivableBalance: balance, balanceSyncedAt: new Date() },
      });
      ctx.updated++;
    } catch (e) {
      ctx.fail(cp.name, e);
    }
  }
}
