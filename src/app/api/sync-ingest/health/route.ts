/**
 * GET /api/sync-ingest/health — перевірка зв'язку та стану синхронізації.
 *
 * Логіка — у `@/lib/sync-ingest/handlers`, спільна з воркером на Railway.
 */

import { handleHealth } from "@/lib/sync-ingest/handlers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleHealth(req);
}
