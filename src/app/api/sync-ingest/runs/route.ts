/**
 * POST /api/sync-ingest/runs — старт прогону синхронізації з 1С.
 *
 * Логіка — у `@/lib/sync-ingest/handlers`, спільна з воркером на Railway.
 * Цей маршрут лишається робочим запасним шляхом: щоб повернути обмін на
 * Vercel, достатньо змінити `ingest.url` у конфізі агента на сервері 1С.
 */

import { handleStartRun } from "@/lib/sync-ingest/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handleStartRun(req);
}
