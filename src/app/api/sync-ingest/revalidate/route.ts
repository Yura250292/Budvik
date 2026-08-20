/**
 * POST /api/sync-ingest/revalidate — скидання кешу вітрини на вимогу воркера.
 *
 * `revalidateTag`/`revalidatePath` працюють лише всередині процесу Next, тому
 * воркер на Railway, який приймає дані від 1С, не може скинути кеш сам. Він
 * стукає сюди — це єдине, заради чого обмін узагалі торкається Vercel.
 *
 * Викликів мало: тротл на боці воркера (раз на 15 хвилин) дає ≤96 на добу.
 *
 * Авторизація — той самий HMAC-підпис агента: секрет уже спільний для сайту
 * й воркера, заводити другий не було б за що.
 *
 * Чому саме під `/api/sync-ingest/`, а не окремим `/api/revalidate`: у фаєрволі
 * Vercel цей префікс виключено з бот-челенджу. Будь-який інший шлях відповідає
 * машині сторінкою «Vercel Security Checkpoint» із кодом 429 — перевірено на
 * проді, воркер отримував би її замість скидання кешу.
 */

import { authenticateAgent } from "@/lib/sync-ingest/auth";
import { bustStorefrontCache } from "@/lib/storefront-cache";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  bustStorefrontCache();

  return Response.json({ ok: true, revalidatedAt: new Date().toISOString() });
}
