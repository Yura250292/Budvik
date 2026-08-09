/**
 * GET /api/sync-ingest/health — перевірка зв'язку та стану синхронізації.
 *
 * Агент б'ється сюди на старті, щоб одразу впасти з внятною помилкою, якщо
 * секрет не збігається — краще, ніж виявити це на першому батчі даних.
 * Також показує, коли агента чули востаннє: цим користується моніторинг.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "@/lib/sync-ingest/auth";
import { getSyncState } from "@/lib/sync-ingest/context";
import { SYNC_STATE_KEYS, type HealthResponse } from "@/lib/sync-ingest/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [agentLastSeen, lastJob] = await Promise.all([
    getSyncState(SYNC_STATE_KEYS.agentLastSeen),
    prisma.syncJob.findFirst({
      where: { type: { startsWith: "agent-" } },
      orderBy: { startedAt: "desc" },
      select: {
        fileName: true,
        type: true,
        status: true,
        startedAt: true,
        completedAt: true,
      },
    }),
  ]);

  return NextResponse.json<HealthResponse>({
    ok: true,
    serverTime: new Date().toISOString(),
    agentLastSeen,
    lastRun: lastJob
      ? {
          runId: lastJob.fileName,
          type: lastJob.type,
          status: lastJob.status,
          startedAt: lastJob.startedAt.toISOString(),
          completedAt: lastJob.completedAt?.toISOString() ?? null,
        }
      : null,
  });
}
