/**
 * POST /api/sync-ingest/runs/[runId]/complete — закриття прогону.
 *
 * Логіка — у `@/lib/sync-ingest/handlers`, спільна з воркером на Railway.
 * Різниця лише в скиданні кешу: тут воно пряме, бо ми всередині Next.
 */

import { handleCompleteRun } from "@/lib/sync-ingest/handlers";
import { bustStorefrontCache } from "@/lib/storefront-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  return handleCompleteRun(req, runId, {
    bustCache: async () => bustStorefrontCache(),
  });
}
