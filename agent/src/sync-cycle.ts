/**
 * Один цикл синхронізації: прочитати 1С → відсіяти незмінене → покласти
 * в чергу → доставити → зафіксувати доставлене.
 *
 * Порядок типів сутностей не випадковий: категорії й склади мають доїхати
 * раніше за товари й залишки, інакше нові товари потраплять у категорію
 * «Імпорт з 1С», а залишки не знайдуть складу.
 */

import crypto from "node:crypto";
import type { BatchRequest, SyncEntityType, SyncRunKind } from "@contract";
import type { AgentConfig } from "./config.js";
import type { Logger } from "./log.js";
import { ODataClient } from "./odata/client.js";
import { StateStore } from "./state/store.js";
import { Outbox } from "./outbox.js";
import { IngestClient, TransportError } from "./push.js";
import { extractCatalog, extractCounterparties, extractWarehouses } from "./extract/catalog.js";
import { extractDebts, extractPrices, extractStock, stockHashKey } from "./extract/registers.js";
import { extractSalesDocuments, extractPurchaseDocuments } from "./extract/documents.js";

export interface CycleResult {
  runId: string;
  kind: SyncRunKind;
  sent: number;
  delivered: number;
  pending: number;
  failed: boolean;
}

interface Collected {
  entityType: SyncEntityType;
  /** Усі записи з 1С — потрібні для повного зрізу. */
  all: { externalId: string }[];
  /** Лише змінені — саме вони йдуть у чергу. */
  changed: { externalId: string }[];
  /** Ключ для hash-diff, якщо externalId недостатньо (залишки). */
  hashKey?: (record: never) => string;
}

export class SyncCycle {
  private readonly odata: ODataClient;

  constructor(
    private readonly config: AgentConfig,
    private readonly state: StateStore,
    private readonly outbox: Outbox,
    private readonly ingest: IngestClient,
    private readonly log: Logger
  ) {
    this.odata = new ODataClient(config.odata, log);
  }

  /**
   * Повний прогін: у ньому надсилаються ВСІ записи (не лише змінені) і до
   * останнього батча кожного типу додається повний зріз ідентифікаторів,
   * за яким сервер виявляє позиції, що зникли з 1С.
   */
  async run(kind: SyncRunKind): Promise<CycleResult> {
    const runId = crypto.randomUUID();
    const isFull = kind === "full";

    this.log.info({ runId, kind }, "Старт циклу синхронізації");

    // Спершу доставляємо все, що застрягло з минулих циклів.
    const carriedOver = await this.drainOutbox();
    if (carriedOver > 0) {
      this.log.info({ carriedOver }, "Доставлено батчі з попередніх циклів");
    }

    let collected: Collected[];
    try {
      collected = await this.collect(isFull);
    } catch (e) {
      this.log.error({ runId, error: e instanceof Error ? e.message : String(e) }, "Читання 1С впало");
      return { runId, kind, sent: 0, delivered: 0, pending: this.outbox.size(), failed: true };
    }

    const totalChanged = collected.reduce((sum, c) => sum + c.changed.length, 0);

    if (totalChanged === 0 && !isFull) {
      this.log.info({ runId }, "Змін немає — прогін не створюється");
      return { runId, kind, sent: 0, delivered: 0, pending: this.outbox.size(), failed: false };
    }

    // Прогін реєструємо лише коли є що надсилати: інакше журнал синхронізації
    // засмічується порожніми записами кожні 20 хвилин.
    try {
      const started = await this.ingest.startRun({
        runId,
        kind,
        startedAt: new Date().toISOString(),
        agentVersion: "1.0.0",
      });
      this.log.info({ runId, syncJobId: started.syncJobId }, "Прогін зареєстровано");
    } catch (e) {
      this.log.error(
        { runId, error: e instanceof Error ? e.message : String(e) },
        "Не вдалося зареєструвати прогін"
      );
      return { runId, kind, sent: 0, delivered: 0, pending: this.outbox.size(), failed: true };
    }

    // Формування черги.
    let seq = 0;
    const now = Date.now();

    for (const group of collected) {
      const records = isFull ? group.all : group.changed;
      if (records.length === 0) continue;

      const chunks = chunk(records, this.config.batchSize);

      for (const [index, part] of chunks.entries()) {
        const isLastChunk = index === chunks.length - 1;

        const batch: BatchRequest = {
          runId,
          batchId: crypto.randomUUID(),
          seq: seq++,
          entityType: group.entityType,
          records: part as BatchRequest["records"],
          // Повний зріз чіпляємо лише до останнього батча типу.
          ...(isFull && isLastChunk
            ? { fullSnapshotIds: group.all.map((r) => r.externalId) }
            : {}),
        };

        this.outbox.enqueue(batch, now);
      }
    }

    const delivered = await this.drainOutbox(collected);
    const pending = this.outbox.size();

    try {
      const summary = await this.ingest.completeRun(runId, {
        status: pending > 0 ? "failed" : "completed",
        ...(pending > 0 ? { error: `${pending} батчів не доставлено` } : {}),
      });
      this.log.info(
        {
          runId,
          created: summary.recordsCreated,
          updated: summary.recordsUpdated,
          skipped: summary.recordsSkipped,
          failed: summary.recordsFailed,
          discrepancies: summary.discrepancies,
          missing: summary.missing,
        },
        "Прогін завершено"
      );
    } catch (e) {
      this.log.error(
        { runId, error: e instanceof Error ? e.message : String(e) },
        "Не вдалося закрити прогін"
      );
    }

    const removed = this.outbox.pruneStale();
    if (removed > 0) this.log.warn({ removed }, "Видалено застарілі батчі з черги");

    return { runId, kind, sent: totalChanged, delivered, pending, failed: pending > 0 };
  }

  /** Читає з 1С усе, що ввімкнено в config.scope. */
  private async collect(isFull: boolean): Promise<Collected[]> {
    const { scope } = this.config;
    const groups: Collected[] = [];

    /** У повному прогоні hash-diff не застосовується — шлемо все. */
    const diff = <T extends { externalId: string }>(
      entityType: string,
      records: T[],
      keyOf?: (r: T) => string
    ): T[] => {
      if (isFull) return records;
      if (!keyOf) return this.state.filterChanged(entityType, records);

      // Складений ключ (залишки): підміняємо externalId на час порівняння.
      const keyed = records.map((r) => ({ ...r, externalId: keyOf(r) }));
      const changedKeys = new Set(
        this.state.filterChanged(entityType, keyed).map((r) => r.externalId)
      );
      return records.filter((r) => changedKeys.has(keyOf(r)));
    };

    if (scope.categories || scope.products) {
      const { categories, products } = await extractCatalog(this.odata, this.config.entities);

      if (scope.categories) {
        groups.push({
          entityType: "category",
          all: categories,
          changed: diff("category", categories),
        });
      }
      if (scope.products) {
        groups.push({
          entityType: "product",
          all: products,
          changed: diff("product", products),
        });
      }
      this.log.info(
        { categories: categories.length, products: products.length },
        "Довідник номенклатури прочитано"
      );
    }

    if (scope.warehouses) {
      const warehouses = await extractWarehouses(this.odata, this.config.entities);
      groups.push({
        entityType: "warehouse",
        all: warehouses,
        changed: diff("warehouse", warehouses),
      });
    }

    if (scope.prices) {
      const prices = await extractPrices(this.odata, this.config);
      groups.push({ entityType: "price", all: prices, changed: diff("price", prices) });
      this.log.info({ prices: prices.length }, "Зріз цін прочитано");
    }

    if (scope.stock) {
      const stock = await extractStock(this.odata, this.config);
      groups.push({
        entityType: "stock",
        all: stock,
        changed: diff("stock", stock, stockHashKey),
      });
      this.log.info({ stock: stock.length }, "Залишки прочитано");
    }

    if (scope.counterparties) {
      const counterparties = await extractCounterparties(this.odata, this.config.entities);
      groups.push({
        entityType: "counterparty",
        all: counterparties,
        changed: diff("counterparty", counterparties),
      });
    }

    if (scope.documents) {
      const sales = await extractSalesDocuments(this.odata, this.config);
      const purchases = await extractPurchaseDocuments(this.odata, this.config);
      groups.push({ entityType: "sales_doc", all: sales, changed: diff("sales_doc", sales) });
      groups.push({
        entityType: "purchase_doc",
        all: purchases,
        changed: diff("purchase_doc", purchases),
      });
    }

    if (scope.debts) {
      const debts = await extractDebts(this.odata, this.config);
      groups.push({ entityType: "debt", all: debts, changed: diff("debt", debts) });
    }

    return groups;
  }

  /**
   * Надсилає всі батчі з черги.
   *
   * Хеші фіксуються ЛИШЕ після підтвердження сервером: інакше обрив зв'язку
   * назавжди «загубив» би зміну — наступний цикл вважав би її надісланою.
   */
  private async drainOutbox(collected?: Collected[]): Promise<number> {
    const entries = this.outbox.list();
    let delivered = 0;

    for (const { file, batch } of entries) {
      try {
        const res = await this.ingest.sendBatch(batch);

        this.outbox.remove(file);
        delivered++;

        if (res.duplicate) {
          this.log.debug({ batchId: batch.batchId }, "Батч уже застосований раніше");
        } else if (res.failed > 0) {
          this.log.warn(
            { batchId: batch.batchId, failed: res.failed, errors: res.errors },
            "Частина записів у батчі не застосувалася"
          );
        }

        // Фіксуємо хеші лише для батчів поточного циклу — для доставлених
        // з минулих циклів записів дані про них уже втрачені разом з `collected`.
        if (collected) this.markBatchSent(batch, collected);
      } catch (e) {
        if (e instanceof TransportError && e.permanent) {
          // Сервер відхилив батч назавжди (наприклад, зіпсовані дані).
          // Тримати його в черзі — блокувати всю подальшу доставку.
          this.log.error(
            { batchId: batch.batchId, status: e.status, error: e.message },
            "Батч відхилено сервером — видалено з черги"
          );
          this.outbox.remove(file);
          continue;
        }

        this.log.warn(
          { batchId: batch.batchId, error: e instanceof Error ? e.message : String(e) },
          "Батч не доставлено — лишається в черзі до наступного циклу"
        );
        // Порядок доставки важливий (категорії перед товарами), тому на
        // першій же мережевій помилці зупиняємось.
        break;
      }
    }

    return delivered;
  }

  /** Позначає записи доставленого батча як надіслані. */
  private markBatchSent(batch: BatchRequest, collected: Collected[]): void {
    const group = collected.find((g) => g.entityType === batch.entityType);
    if (!group) return;

    const records = batch.records as { externalId: string }[];

    if (batch.entityType === "stock") {
      // Складений ключ — той самий, що й під час порівняння.
      this.state.markSent(
        "stock",
        records.map((r) => ({
          ...r,
          externalId: stockHashKey(r as never),
        }))
      );
      return;
    }

    this.state.markSent(batch.entityType, records);
  }

  /** Перевірка зв'язку з 1С і з сайтом перед першим циклом. */
  async verifyConnections(): Promise<void> {
    await this.odata.ping();
    this.log.info("Зв'язок з 1С OData встановлено");

    const health = await this.ingest.health();
    this.log.info(
      { serverTime: health.serverTime, lastRun: health.lastRun?.runId ?? null },
      "Зв'язок із сайтом встановлено"
    );
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
