/**
 * Обробники обміну з 1С, не прив'язані до Next.js.
 *
 * Уся логіка живе тут, а не в маршрутах, бо ті самі чотири ендпоінти
 * обслуговуються з двох місць: маршрутами Next на Vercel (запасний шлях) і
 * воркером на Railway (основний). Воркер пише в базу приватною мережею й не
 * коштує викликів функцій — заради цього все й виносилось.
 *
 * Приймають стандартний Web `Request` і повертають `Response`; єдине, що
 * відрізняє середовища, — скидання кешу вітрини (`bustCache`), яке можливе
 * лише всередині Next.
 */

import { prisma } from "@/lib/prisma";
import { authenticateAgent } from "./auth";
import {
  ApplyContext,
  accumulateJobCounters,
  flushDiscrepancies,
  getSyncState,
  setSyncState,
} from "./context";
import { dispatchBatch, detectMissing } from "./dispatch";
import { reconcileDebts } from "./reconcile-debts";
import { reconcilePrices } from "./reconcile-prices";
import { reconcilePayments } from "./reconcile-payments";
import { reconcileStock } from "./reconcile-stock";
import {
  alertMassPriceChange,
  alertMissingEntities,
  alertQueryFailed,
  alertRunFailed,
  MISSING_ALERT_THRESHOLD,
  PRICE_CHANGE_ALERT_RATIO,
} from "./alerts";
import {
  MAX_BATCH_RECORDS,
  SYNC_STATE_KEYS,
  type BatchRequest,
  type BatchResponse,
  type CompleteRunRequest,
  type CompleteRunResponse,
  type HealthResponse,
  type StartRunRequest,
  type StartRunResponse,
  type SyncRunKind,
} from "./types";

/** Як часто обмін має право скидати кеш вітрини. Див. коментар у handleCompleteRun. */
export const CACHE_BUST_INTERVAL_MS = 15 * 60_000;

export interface IngestDeps {
  /**
   * Скидання кешу вітрини. У Next — прямі `revalidateTag`/`revalidatePath`,
   * у воркері — підписаний виклик сайту. Тротл лишається на боці викликача
   * цього модуля (стан у Postgres), тож сюди звертаються ≤96 разів на добу.
   */
  bustCache: () => Promise<void>;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/**
 * POST /api/sync-ingest/runs — старт прогону синхронізації з 1С.
 *
 * Створює SyncJob, у якому fileName = runId (агент не має файлу, але поле
 * обов'язкове й уже використовується адмінкою як ідентифікатор джерела).
 */
export async function handleStartRun(req: Request): Promise<Response> {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body: StartRunRequest;
  try {
    body = JSON.parse(auth.rawBody);
  } catch {
    return json({ error: "Некоректний JSON" }, 400);
  }

  if (!body.runId || !body.kind) {
    return json({ error: "Відсутні runId або kind" }, 400);
  }

  await setSyncState(SYNC_STATE_KEYS.agentLastSeen, new Date().toISOString());

  // Повторна відправка старту (агент не отримав відповідь) не має плодити
  // дублікати SyncJob.
  const existing = await prisma.syncJob.findFirst({
    where: { fileName: body.runId },
    select: { id: true },
  });

  if (existing) {
    const payload: StartRunResponse = {
      runId: body.runId,
      syncJobId: existing.id,
      duplicate: true,
    };
    return json(payload);
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

  const payload: StartRunResponse = {
    runId: body.runId,
    syncJobId: job.id,
    duplicate: false,
  };
  return json(payload);
}

/**
 * POST /api/sync-ingest/batch — приймає порцію записів від агента 1С.
 *
 * Ідемпотентність: batchId реєструється в SyncBatch ДО застосування.
 * Якщо агент передав той самий батч удруге (не дочекався відповіді через
 * обрив зв'язку), другий раз він не застосується.
 */
export async function handleBatch(req: Request): Promise<Response> {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body: BatchRequest;
  try {
    // Текст з 1С приходить із «ö» у двох Unicode-формах (складеній U+00F6 і
    // розкладеній o+U+0308). Для Postgres і @unique це різні рядки: так у
    // довіднику з'явився другий «Grösser», а contains по назві губив третину
    // товарів бренду. Приводимо весь пакет до NFC на вході — ASCII (GUID,
    // числа, структура JSON) від цього не змінюється.
    body = JSON.parse(auth.rawBody.normalize("NFC"));
  } catch {
    return json({ error: "Некоректний JSON" }, 400);
  }

  if (!body.runId || !body.batchId || !body.entityType || !Array.isArray(body.records)) {
    return json({ error: "Відсутні runId, batchId, entityType або records" }, 400);
  }

  if (body.records.length > MAX_BATCH_RECORDS) {
    return json(
      { error: `Забагато записів у батчі: ${body.records.length} > ${MAX_BATCH_RECORDS}` },
      400
    );
  }

  const job = await prisma.syncJob.findFirst({
    where: { fileName: body.runId },
    select: { id: true, type: true, status: true },
  });

  if (!job) {
    return json({ error: "Прогін не знайдено — спершу POST /runs" }, 404);
  }

  await setSyncState(SYNC_STATE_KEYS.agentLastSeen, new Date().toISOString());

  // Реєстрація батча — вона ж перевірка на дублікат: унікальний первинний
  // ключ не дасть створити другий запис із тим самим batchId.
  try {
    await prisma.syncBatch.create({
      data: {
        id: body.batchId,
        runId: body.runId,
        seq: body.seq ?? 0,
        entityType: body.entityType,
        records: body.records.length,
      },
    });
  } catch {
    const payload: BatchResponse = {
      batchId: body.batchId,
      duplicate: true,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      discrepancies: 0,
      errors: [],
    };
    return json(payload);
  }

  const kind: SyncRunKind = job.type.replace("agent-", "") as SyncRunKind;
  const ctx = new ApplyContext(job.id, body.runId, kind);

  try {
    await dispatchBatch(body, ctx);

    // Повний зріз приходить в останньому батчі свого типу.
    if (kind === "full" && body.fullSnapshotIds?.length) {
      await detectMissing(body.entityType, body.fullSnapshotIds, ctx);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`sync-ingest: батч ${body.batchId} впав`, e);
    ctx.errors.push(message);
    ctx.failed += body.records.length;

    // Впалий батч запам'ятовуємо окремо: відповідь усе одно 200, і прогін
    // закриється як успішний, а звірки «чого немає в 1С» наприкінці мусять
    // знати, що зріз неповний, — інакше обнулять живі дані.
    await setSyncState(SYNC_STATE_KEYS.batchErrorKey(body.entityType), body.runId);
  }

  const discrepancies = await flushDiscrepancies(ctx);
  await accumulateJobCounters(job.id, ctx, body.records.length);

  const payload: BatchResponse = {
    batchId: body.batchId,
    duplicate: false,
    created: ctx.created,
    updated: ctx.updated,
    skipped: ctx.skipped,
    failed: ctx.failed,
    discrepancies,
    errors: ctx.errors.slice(0, 20),
  };
  return json(payload);
}

/**
 * POST /api/sync-ingest/runs/[runId]/complete — закриття прогону.
 *
 * Тут же спрацьовують пороги сповіщень: масова зміна цін і велика кількість
 * зниклих позицій. Дивимось на підсумок прогону, а не на окремі батчі —
 * 30 змінених цін у батчі це норма, 30% каталогу за прогін — ні.
 */
export async function handleCompleteRun(
  req: Request,
  runId: string,
  deps: IngestDeps
): Promise<Response> {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body: CompleteRunRequest;
  try {
    body = JSON.parse(auth.rawBody);
  } catch {
    return json({ error: "Некоректний JSON" }, 400);
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
    return json({ error: "Прогін не знайдено" }, 404);
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

  // --- Звірки «чого більше немає в 1С» ---
  // Регістри віддають лише ненульові значення: закритий борг і прибрана ціна
  // не приходять нулем, а просто зникають із каналу. Побачити це можна лише
  // тут, коли зріз приїхав цілком. Борг обнуляємо, ціну лише реєструємо —
  // чому саме так, пояснено в reconcile-debts.ts і reconcile-prices.ts.
  //
  // Прогін із впалим запитом боргу пропускаємо: 1С його не віддала взагалі,
  // і «зниклими» виглядали б усі боржники одразу.
  let reconcileDiscrepancies = 0;
  if (status !== "failed" && !body.counts?.debtFailed) {
    try {
      const kind: SyncRunKind = job.type.replace("agent-", "") as SyncRunKind;
      const ctx = new ApplyContext(job.id, runId, kind);
      const zeroed =
        (await reconcileDebts(ctx)) +
        (await reconcilePrices(ctx)) +
        (await reconcilePayments(ctx)) +
        (await reconcileStock(ctx));
      if (zeroed > 0) {
        reconcileDiscrepancies = await flushDiscrepancies(ctx);
        await accumulateJobCounters(job.id, ctx, 0);
      }
    } catch (e) {
      // Звірка — гігієна даних, а не суть прогону: збій тут не має завалити
      // закриття обміну, який щойно успішно приніс ціни, залишки й документи.
      console.error("sync-ingest: звірка дебіторки не вдалася", e);
    }
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
  if (body.counts?.receiptsFailed) {
    await alertQueryFailed(runId, "надходження товару", String(body.counts.receiptsFailed));
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
      // Мітку ставимо лише після успішного скидання: інакше збій мережі до
      // сайту закрив би вікно на чверть години, і вітрина лишилась би зі
      // старими даними без жодного сліду про причину.
      try {
        await deps.bustCache();
        await setSyncState(SYNC_STATE_KEYS.lastCacheBust, new Date().toISOString());
      } catch (e) {
        console.error("sync-ingest: не вдалося скинути кеш вітрини", e);
      }
    }
  }

  const payload: CompleteRunResponse = {
    runId,
    syncJobId: job.id,
    status,
    recordsCreated: updated.recordsCreated,
    recordsUpdated: updated.recordsUpdated,
    recordsSkipped: updated.recordsSkipped,
    recordsFailed: updated.recordsFailed,
    discrepancies: totalDiscrepancies + reconcileDiscrepancies,
    missing,
  };
  return json(payload);
}

/**
 * GET /api/sync-ingest/health — перевірка зв'язку та стану синхронізації.
 *
 * Агент б'ється сюди на старті, щоб одразу впасти з внятною помилкою, якщо
 * секрет не збігається — краще, ніж виявити це на першому батчі даних.
 * Також показує, коли агента чули востаннє: цим користується моніторинг.
 */
export async function handleHealth(req: Request): Promise<Response> {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

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

  const payload: HealthResponse = {
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
  };
  return json(payload);
}
