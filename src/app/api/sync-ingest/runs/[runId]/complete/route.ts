/**
 * POST /api/sync-ingest/runs/[runId]/complete — закриття прогону.
 *
 * Тут же спрацьовують пороги сповіщень: масова зміна цін і велика кількість
 * зниклих позицій. Дивимось на підсумок прогону, а не на окремі батчі —
 * 30 змінених цін у батчі це норма, 30% каталогу за прогін — ні.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/sync-ingest/auth";
import { setSyncState } from "@/lib/sync-ingest/context";
import {
  alertMassPriceChange,
  alertMissingEntities,
  alertRunFailed,
  MISSING_ALERT_THRESHOLD,
  PRICE_CHANGE_ALERT_RATIO,
} from "@/lib/sync-ingest/alerts";
import {
  SYNC_STATE_KEYS,
  type CompleteRunRequest,
  type CompleteRunResponse,
} from "@/lib/sync-ingest/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { runId } = await params;

  let body: CompleteRunRequest;
  try {
    body = JSON.parse(auth.rawBody);
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const job = await prisma.syncJob.findFirst({
    where: { fileName: runId },
    select: {
      id: true,
      type: true,
      status: true,
      recordsCreated: true,
      recordsUpdated: true,
      recordsSkipped: true,
      recordsFailed: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Прогін не знайдено" }, { status: 404 });
  }

  await setSyncState(SYNC_STATE_KEYS.agentLastSeen, new Date().toISOString());

  const status = body.status === "failed" ? "failed" : "completed";

  const [priceChanges, missing, totalDiscrepancies] = await Promise.all([
    prisma.syncDiscrepancy.count({ where: { syncJobId: job.id, field: "price" } }),
    prisma.syncDiscrepancy.count({ where: { syncJobId: job.id, field: "MISSING" } }),
    prisma.syncDiscrepancy.count({ where: { syncJobId: job.id } }),
  ]);

  const updated = await prisma.syncJob.update({
    where: { id: job.id },
    data: {
      status,
      completedAt: new Date(),
      errors: body.error ? JSON.stringify([body.error]) : undefined,
    },
    select: {
      recordsCreated: true,
      recordsUpdated: true,
      recordsSkipped: true,
      recordsFailed: true,
    },
  });

  if (job.type === "agent-full") {
    await setSyncState(SYNC_STATE_KEYS.lastFullRun, new Date().toISOString());
  }

  // --- Сповіщення ---
  if (status === "failed") {
    await alertRunFailed(runId, body.error || "без деталей");
  } else {
    if (priceChanges > 0) {
      const activeProducts = await prisma.product.count({ where: { isActive: true } });
      if (activeProducts > 0 && priceChanges / activeProducts > PRICE_CHANGE_ALERT_RATIO) {
        await alertMassPriceChange(runId, priceChanges, activeProducts);
      }
    }
    if (missing >= MISSING_ALERT_THRESHOLD) {
      await alertMissingEntities(runId, missing);
    }
  }

  return NextResponse.json<CompleteRunResponse>({
    runId,
    syncJobId: job.id,
    status,
    recordsCreated: updated.recordsCreated,
    recordsUpdated: updated.recordsUpdated,
    recordsSkipped: updated.recordsSkipped,
    recordsFailed: updated.recordsFailed,
    discrepancies: totalDiscrepancies,
    missing,
  });
}
