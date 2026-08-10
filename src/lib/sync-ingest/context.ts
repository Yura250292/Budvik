/**
 * Спільний контекст застосування батча: лічильники, накопичувач розбіжностей,
 * прапорець preview-режиму.
 *
 * Кожен apply-* модуль отримує один такий об'єкт на батч, наповнює його,
 * а маршрут наприкінці зливає розбіжності в БД одним викликом.
 */

import { prisma } from "@/lib/prisma";
import type { SyncRunKind } from "./types";

export interface DiscrepancyDraft {
  entityType: string;
  entityRef: string;
  entityName: string;
  field: string;
  value1C: string;
  valueBudvik: string;
}

export class ApplyContext {
  created = 0;
  updated = 0;
  skipped = 0;
  failed = 0;
  readonly errors: string[] = [];
  readonly discrepancies: DiscrepancyDraft[] = [];

  constructor(
    readonly syncJobId: string,
    readonly runId: string,
    readonly kind: SyncRunKind
  ) {}

  /** У preview-режимі жодного запису в предметні таблиці не відбувається. */
  get isPreview(): boolean {
    return this.kind === "preview";
  }

  discrepancy(d: DiscrepancyDraft): void {
    this.discrepancies.push(d);
  }

  fail(label: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    this.errors.push(`"${label.slice(0, 60)}": ${message}`);
    this.failed++;
  }
}

const CHUNK = 50;

/** Записує накопичені розбіжності. Помилка тут не має валити сам прогін. */
export async function flushDiscrepancies(ctx: ApplyContext): Promise<number> {
  if (ctx.discrepancies.length === 0) return 0;

  const rows = ctx.discrepancies.map((d) => ({ ...d, syncJobId: ctx.syncJobId }));
  let written = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    try {
      const res = await prisma.syncDiscrepancy.createMany({ data: rows.slice(i, i + CHUNK) });
      written += res.count;
    } catch (e) {
      console.error("sync-ingest: не вдалося записати розбіжності", e);
    }
  }

  return written;
}

/** Оновлює лічильники SyncJob наростаючим підсумком після кожного батча. */
export async function accumulateJobCounters(
  syncJobId: string,
  ctx: ApplyContext,
  records: number
): Promise<void> {
  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: {
      recordsTotal: { increment: records },
      recordsCreated: { increment: ctx.created },
      recordsUpdated: { increment: ctx.updated },
      recordsSkipped: { increment: ctx.skipped },
      recordsFailed: { increment: ctx.failed },
    },
  });

  // Тексти помилок зберігаємо окремо: раніше recordsFailed рахувався, а самі
  // повідомлення жили лише у відповіді батча й зникали разом із нею. Прогін
  // із 225 помилками й порожнім полем errors неможливо діагностувати.
  //
  // Перші 50 на прогін: помилки зазвичай однотипні, а необмежене накопичення
  // роздуло б рядок на великому збої.
  if (ctx.errors.length === 0) return;

  const job = await prisma.syncJob.findUnique({
    where: { id: syncJobId },
    select: { errors: true },
  });

  const previous: string[] = job?.errors ? safeParseErrors(job.errors) : [];
  if (previous.length >= 50) return;

  const merged = [...previous, ...ctx.errors].slice(0, 50);
  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { errors: JSON.stringify(merged) },
  });
}

/** Поле errors історично зберігало то JSON-масив, то голий рядок. */
function safeParseErrors(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return [raw];
  }
}

/** Записує значення в SyncState (heartbeat, watermark'и). */
export async function setSyncState(key: string, value: string): Promise<void> {
  await prisma.syncState.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getSyncState(key: string): Promise<string | null> {
  const row = await prisma.syncState.findUnique({ where: { key } });
  return row?.value ?? null;
}
