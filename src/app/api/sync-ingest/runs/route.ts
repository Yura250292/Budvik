/**
 * POST /api/sync-ingest/runs — старт прогону синхронізації з 1С.
 *
 * Створює SyncJob, у якому fileName = runId (агент не має файлу, але поле
 * обов'язкове й уже використовується адмінкою як ідентифікатор джерела).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/sync-ingest/auth";
import { setSyncState } from "@/lib/sync-ingest/context";
import {
  SYNC_STATE_KEYS,
  type StartRunRequest,
  type StartRunResponse,
} from "@/lib/sync-ingest/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: StartRunRequest;
  try {
    body = JSON.parse(auth.rawBody);
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  if (!body.runId || !body.kind) {
    return NextResponse.json({ error: "Відсутні runId або kind" }, { status: 400 });
  }

  await setSyncState(SYNC_STATE_KEYS.agentLastSeen, new Date().toISOString());

  // Повторна відправка старту (агент не отримав відповідь) не має плодити
  // дублікати SyncJob.
  const existing = await prisma.syncJob.findFirst({
    where: { fileName: body.runId },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json<StartRunResponse>({
      runId: body.runId,
      syncJobId: existing.id,
      duplicate: true,
    });
  }

  const job = await prisma.syncJob.create({
    data: {
      type: `agent-${body.kind}`,
      status: "running",
      fileName: body.runId,
      startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
    },
    select: { id: true },
  });

  return NextResponse.json<StartRunResponse>({
    runId: body.runId,
    syncJobId: job.id,
    duplicate: false,
  });
}
