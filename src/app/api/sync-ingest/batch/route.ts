/**
 * POST /api/sync-ingest/batch — приймає порцію записів від агента 1С.
 *
 * Логіка — у `@/lib/sync-ingest/handlers`, спільна з воркером на Railway.
 */

import { handleBatch } from "@/lib/sync-ingest/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handleBatch(req);
}
