/**
 * Стан обміну з 1С — читання без роутів.
 *
 * Про здоров'я обміну питають із трьох місць: агент (health), розділ
 * «Інтеграція» в адмінці й помічник керівника. Доти кожне з них ходило в
 * базу по-своєму, і на питання «коли востаннє оновилися ціни» три екрани
 * могли відповісти по-різному.
 *
 * Файл навмисно не імпортує нічого з next/*: його читає ядро помічника,
 * а воно мусить лишатися придатним для воркера на Railway.
 */

import { prisma } from "@/lib/prisma";
import { getSyncState } from "@/lib/sync-ingest/context";
import { SYNC_STATE_KEYS } from "@/lib/sync-ingest/types";
import type { HealthResponse } from "@/lib/sync-ingest/types";

/** Скільки хвилин без звʼязку, щоб вважати агента мовчазним. */
const AGENT_SILENT_MIN = 120;

/** Скільки годин без батча, щоб канал вважався несвіжим (нічний повний прогін — раз на добу). */
const CHANNEL_STALE_HOURS = 26;

/** Пульс агента й останній його прогін — те, що віддає /api/sync-ingest/health. */
export async function agentHealth(): Promise<Pick<HealthResponse, "agentLastSeen" | "lastRun">> {
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

  return {
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
  };
}

/** Журнал прогонів для розділу «Інтеграція». */
export async function listSyncJobs(limit = 50) {
  return prisma.syncJob.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { _count: { select: { discrepancies: true } } },
  });
}

export type DiscrepancyFilter = {
  syncJobId?: string;
  resolved?: boolean;
  entityType?: string;
};

export async function listDiscrepancies(filter: DiscrepancyFilter, limit = 200) {
  return prisma.syncDiscrepancy.findMany({
    where: filter,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { syncJob: { select: { fileName: true, createdAt: true } } },
  });
}

/** Скільки нерозібраних розбіжностей і якого саме роду. */
export async function unresolvedDiscrepancyCounts(): Promise<
  Array<{ entityType: string; field: string; count: number }>
> {
  const rows = await prisma.syncDiscrepancy.groupBy({
    by: ["entityType", "field"],
    where: { resolved: false },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ entityType: r.entityType, field: r.field, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Коли кожен канал востаннє привозив дані.
 *
 * Саме це, а не «прогін завершився», відповідає на питання «чому на сайті
 * стара ціна»: прогін міг пройти успішно, а конкретний запит — упасти на
 * боці 1С і не прислати жодного батча.
 */
export async function channelFreshness(): Promise<
  Array<{ entityType: string; lastAt: Date; runId: string }>
> {
  return prisma.$queryRaw<Array<{ entityType: string; lastAt: Date; runId: string }>>`
    SELECT DISTINCT ON ("entityType") "entityType", "createdAt" AS "lastAt", "runId"
    FROM "SyncBatch"
    ORDER BY "entityType", "createdAt" DESC
  `;
}

export type SyncHealth = {
  now: Date;
  agent: { lastSeen: Date | null; minutesAgo: number | null; silent: boolean };
  lastRun: HealthResponse["lastRun"];
  last24h: { jobs: number; failed: number };
  recentJobs: Array<{
    startedAt: Date;
    completedAt: Date | null;
    type: string;
    status: string;
    total: number;
    failed: number;
    discrepancies: number;
    errors: string[];
  }>;
  channels: Array<{ entityType: string; lastAt: Date; hoursAgo: number; stale: boolean }>;
  unresolved: Array<{ entityType: string; field: string; count: number }>;
  /** Коли востаннє приїжджали сальдо: борги живуть окремим каналом і застигають окремо. */
  debtsSyncedAt: Date | null;
};

/** Помилки прогону лежать JSON-рядком; беремо перші й підрізаємо. */
function parseErrors(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.slice(0, 5).map((e) => String(typeof e === "string" ? e : JSON.stringify(e)).slice(0, 200));
  } catch {
    return [raw.slice(0, 200)];
  }
}

export async function syncHealthFacts(now: Date = new Date()): Promise<SyncHealth> {
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const [agent, jobs, dayJobs, channels, unresolved, debts] = await Promise.all([
    agentHealth(),
    prisma.syncJob.findMany({
      orderBy: { startedAt: "desc" },
      take: 8,
      select: {
        startedAt: true,
        completedAt: true,
        type: true,
        status: true,
        recordsTotal: true,
        recordsFailed: true,
        errors: true,
        _count: { select: { discrepancies: true } },
      },
    }),
    prisma.syncJob.findMany({
      where: { startedAt: { gte: dayAgo } },
      select: { status: true },
    }),
    channelFreshness(),
    unresolvedDiscrepancyCounts(),
    prisma.counterparty.aggregate({ _max: { balanceSyncedAt: true } }),
  ]);

  const lastSeen = agent.agentLastSeen ? new Date(agent.agentLastSeen) : null;
  const minutesAgo = lastSeen ? Math.floor((now.getTime() - lastSeen.getTime()) / 60_000) : null;

  return {
    now,
    agent: {
      lastSeen,
      minutesAgo,
      silent: minutesAgo == null || minutesAgo > AGENT_SILENT_MIN,
    },
    lastRun: agent.lastRun,
    last24h: {
      jobs: dayJobs.length,
      failed: dayJobs.filter((j) => j.status === "failed").length,
    },
    recentJobs: jobs.map((j) => ({
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      type: j.type,
      status: j.status,
      total: j.recordsTotal,
      failed: j.recordsFailed,
      discrepancies: j._count.discrepancies,
      errors: parseErrors(j.errors),
    })),
    channels: channels.map((c) => {
      const hoursAgo = Math.round(((now.getTime() - c.lastAt.getTime()) / 3_600_000) * 10) / 10;
      return { entityType: c.entityType, lastAt: c.lastAt, hoursAgo, stale: hoursAgo > CHANNEL_STALE_HOURS };
    }),
    unresolved,
    debtsSyncedAt: debts._max.balanceSyncedAt ?? null,
  };
}
