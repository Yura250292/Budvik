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
import { setSyncState } from "@/lib/sync-ingest/context";
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

  // Обмін міг додати/прибрати категорії й товари, а сайдбар каталогу читає їх
  // з кешу на годину. Без цього скидання нова категорія з'явилась би на сайті
  // лише через годину після обміну.
  if (status !== "failed") {
    revalidateTag(CATEGORIES_CACHE_TAG, { expire: 3600 });
    // Дерево брендів, зміст і кешовані сторінки видачі каталогу — все, що
    // читає товари з кешу. Без цього нові ціни й залишки чекали б кінця
    // вікна кешу (до години для дерева брендів).
    revalidateTag(CATALOG_CACHE_TAG, { expire: 3600 });
    // Головна і каталог кешуються по часу (revalidate). Без явного скидання
    // нові ціни й залишки з обміну чекали б кінця вікна кешу.
    revalidatePath("/");
    revalidatePath("/catalog");
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
