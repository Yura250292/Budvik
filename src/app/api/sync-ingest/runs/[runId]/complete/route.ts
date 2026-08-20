/**
 * POST /api/sync-ingest/runs/[runId]/complete — закриття прогону.
 *
 * Тут же спрацьовують пороги сповіщень: масова зміна цін і велика кількість
 * зниклих позицій. Дивимось на підсумок прогону, а не на окремі батчі —
 * 30 змінених цін у батчі це норма, 30% каталогу за прогін — ні.
 */

import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CATEGORIES_CACHE_TAG } from "@/lib/categories-cache";
import { CATALOG_CACHE_TAG } from "@/lib/catalog/brand-tree";
import { authenticateAgent } from "@/lib/sync-ingest/auth";
import { getSyncState, setSyncState } from "@/lib/sync-ingest/context";
import {
  alertMassPriceChange,
  alertMissingEntities,
  alertQueryFailed,
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

/** Як часто обмін має право скидати кеш вітрини. Див. коментар нижче. */
const CACHE_BUST_INTERVAL_MS = 15 * 60_000;

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
  // Пропущені best-effort запити перевіряємо незалежно від статусу: прогін,
  // у якому впав лише запит боргу чи оплат, вважається успішним, і саме тому
  // без окремого сповіщення про нього ніхто не дізнається.
  if (body.counts?.debtFailed) {
    await alertQueryFailed(runId, "дебіторка", String(body.counts.debtFailed));
  }
  if (body.counts?.paymentsFailed) {
    await alertQueryFailed(runId, "оплати (ПКО)", String(body.counts.paymentsFailed));
  }

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

  // Скидання кешу вітрини — не частіше, ніж раз на CACHE_BUST_INTERVAL_MS.
  //
  // Обмін інкрементальний і приходить КОЖНІ 5 ХВИЛИН цілодобово (288 разів
  // на добу), щоразу з ~285 оновленими записами з 4600. Якщо скидати кеш на
  // кожному прогоні, жодна сторінка не доживає до другого відвідувача: кеш
  // вмирає раніше, ніж окупить свій перший — платний — рендер. Саме на цьому
  // 20.08 згорів рахунок Vercel: 26 тис. карток перерендерювались наново
  // кожні 5 хвилин під обходом ботів.
  //
  // Тому: раз на чверть години. Ціна й залишок на вітрині відстають щонайбільше
  // на 15 хвилин — для магазину інструментів це непомітно, а на картці товару
  // ціна й так підтягується блоком на клієнті.
  //
  // Сторінки товарів навмисно НЕ скидаємо пачкою: revalidatePath(route, "page")
  // вбиває всі 26 тис. карток одним рядком. Їм вистачає власного revalidate =
  // 3600 — година несвіжості на картці дешевша за перерендер усього каталогу.
  if (status !== "failed") {
    const last = await getSyncState(SYNC_STATE_KEYS.lastCacheBust);
    const lastMs = last ? Date.parse(last) : 0;
    const due = !Number.isFinite(lastMs) || Date.now() - lastMs >= CACHE_BUST_INTERVAL_MS;

    if (due) {
      revalidateTag(CATEGORIES_CACHE_TAG, { expire: 3600 });
      // Дерево брендів, зміст і кешовані сторінки видачі каталогу — все, що
      // читає товари з кешу.
      revalidateTag(CATALOG_CACHE_TAG, { expire: 3600 });
      revalidatePath("/");
      revalidatePath("/catalog");
      await setSyncState(SYNC_STATE_KEYS.lastCacheBust, new Date().toISOString());
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
