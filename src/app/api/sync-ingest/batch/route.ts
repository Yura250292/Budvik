/**
 * POST /api/sync-ingest/batch — приймає порцію записів від агента 1С.
 *
 * Ідемпотентність: batchId реєструється в SyncBatch ДО застосування.
 * Якщо агент передав той самий батч удруге (не дочекався відповіді через
 * обрив зв'язку), другий раз він не застосується.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/sync-ingest/auth";
import {
  ApplyContext,
  accumulateJobCounters,
  flushDiscrepancies,
  setSyncState,
} from "@/lib/sync-ingest/context";
import { dispatchBatch, detectMissing } from "@/lib/sync-ingest/dispatch";
import {
  MAX_BATCH_RECORDS,
  SYNC_STATE_KEYS,
  type BatchRequest,
  type BatchResponse,
  type SyncRunKind,
} from "@/lib/sync-ingest/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: BatchRequest;
  try {
    body = JSON.parse(auth.rawBody);
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  if (!body.runId || !body.batchId || !body.entityType || !Array.isArray(body.records)) {
    return NextResponse.json(
      { error: "Відсутні runId, batchId, entityType або records" },
      { status: 400 }
    );
  }

  if (body.records.length > MAX_BATCH_RECORDS) {
    return NextResponse.json(
      { error: `Забагато записів у батчі: ${body.records.length} > ${MAX_BATCH_RECORDS}` },
      { status: 400 }
    );
  }

  const job = await prisma.syncJob.findFirst({
    where: { fileName: body.runId },
    select: { id: true, type: true, status: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Прогін не знайдено — спершу POST /runs" }, { status: 404 });
  }

  await setSyncState(SYNC_STATE_KEYS.agentLastSeen, new Date().toISOString());

  // Реєстрація батча — вона ж перевірка на дублікат: унікальний первинний
  // ключ не дасть створити другий запис із тим самим batchId.
  try {
    await prisma.syncBatch.create({
      data: {
        id: body.batchId,
        runId: body.runId,
        seq: body.seq ?? 0,
        entityType: body.entityType,
        records: body.records.length,
      },
    });
  } catch {
    return NextResponse.json<BatchResponse>({
      batchId: body.batchId,
      duplicate: true,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      discrepancies: 0,
      errors: [],
    });
  }

  const kind: SyncRunKind = job.type.replace("agent-", "") as SyncRunKind;
  const ctx = new ApplyContext(job.id, body.runId, kind);

  try {
    await dispatchBatch(body, ctx);

    // Повний зріз приходить в останньому батчі свого типу.
    if (kind === "full" && body.fullSnapshotIds?.length) {
      await detectMissing(body.entityType, body.fullSnapshotIds, ctx);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`sync-ingest: батч ${body.batchId} впав`, e);
    ctx.errors.push(message);
    ctx.failed += body.records.length;
  }

  const discrepancies = await flushDiscrepancies(ctx);
  await accumulateJobCounters(job.id, ctx, body.records.length);

  return NextResponse.json<BatchResponse>({
    batchId: body.batchId,
    duplicate: false,
    created: ctx.created,
    updated: ctx.updated,
    skipped: ctx.skipped,
    failed: ctx.failed,
    discrepancies,
    errors: ctx.errors.slice(0, 20),
  });
}
