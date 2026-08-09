/**
 * Витягування регістрів 1С: ціни, залишки на складах, взаєморозрахунки.
 *
 * Регістри — найтендітніша частина обміну: їхні імена й склад вимірів
 * помітно відрізняються між УТ, BAS і УНФ. Усі імена винесені в конфіг,
 * а імена полів усередині рядків шукаються з переліком альтернатив.
 */

import type { DebtRecord, PriceRecord, StockRecord } from "@contract";
import type { ODataClient } from "../odata/client.js";
import type { AgentConfig } from "../config.js";
import { num, ref, type Row } from "./catalog.js";

/**
 * Ціни з останнього зрізу.
 *
 * 1С повертає окремий рядок на кожен вид ціни, тож зводимо їх в один запис
 * на товар: роздрібна + оптова.
 */
export async function extractPrices(
  client: ODataClient,
  config: AgentConfig
): Promise<PriceRecord[]> {
  const rows = await client.fetchFunction<Row>(config.entities.priceSlice);

  const { retail, wholesale } = config.priceTypes;
  const byProduct = new Map<string, PriceRecord>();

  for (const row of rows) {
    const productId = ref(row, "Номенклатура_Key", "Номенклатура");
    const priceTypeId = ref(row, "ВидЦены_Key", "ТипЦен_Key", "ВидЦены", "ТипЦен");
    const value = num(row, "Цена", "Ціна", "Price");

    if (!productId || value === undefined) continue;

    const record = byProduct.get(productId) ?? { externalId: productId };

    if (priceTypeId === retail) record.retail = value;
    else if (priceTypeId === wholesale) record.wholesale = value;
    else continue; // інші види цін нас не цікавлять

    byProduct.set(productId, record);
  }

  // Записи без жодної впізнаної ціни відкидаємо: порожній запис лише
  // марно займе місце в батчі.
  return [...byProduct.values()].filter((p) => p.retail !== undefined || p.wholesale !== undefined);
}

/**
 * Залишки по складах.
 *
 * Ключ запису — пара «товар + склад», тому externalId тут складений:
 * інакше hash-diff вважав би різні склади одним записом.
 */
export async function extractStock(
  client: ODataClient,
  config: AgentConfig
): Promise<(StockRecord & { externalId: string })[]> {
  const rows = await client.fetchFunction<Row>(config.entities.stockBalance);

  const records: (StockRecord & { externalId: string })[] = [];

  for (const row of rows) {
    const productId = ref(row, "Номенклатура_Key", "Номенклатура");
    const warehouseId = ref(row, "Склад_Key", "Склад", "Хранилище_Key");
    const quantity = num(row, "КоличествоBalance", "Количество", "КількістьBalance", "Кількість");

    if (!productId || !warehouseId || quantity === undefined) continue;

    records.push({
      externalId: productId,
      warehouseExternalId: warehouseId,
      quantity: Math.max(0, Math.round(quantity)),
    });
  }

  return records;
}

/**
 * Ключ для hash-diff залишків: складений з товару й складу.
 * Виноситься окремо, бо StockRecord.externalId несе лише товар.
 */
export function stockHashKey(record: StockRecord): string {
  return `${record.externalId}:${record.warehouseExternalId}`;
}

/** Сальдо взаєморозрахунків по контрагентах. */
export async function extractDebts(
  client: ODataClient,
  config: AgentConfig
): Promise<DebtRecord[]> {
  const rows = await client.fetchFunction<Row>(config.entities.debtBalance);

  const byCounterparty = new Map<string, number>();

  for (const row of rows) {
    const counterpartyId = ref(row, "Контрагент_Key", "Контрагент", "Клиент_Key");
    const amount = num(
      row,
      "СуммаBalance",
      "Сумма",
      "СуммаВзаиморасчетовBalance",
      "СуммаВзаиморасчетов"
    );

    if (!counterpartyId || amount === undefined) continue;

    // За контрагентом може бути кілька рядків (за договорами) — підсумовуємо.
    byCounterparty.set(counterpartyId, (byCounterparty.get(counterpartyId) ?? 0) + amount);
  }

  return [...byCounterparty.entries()].map(([externalId, balance]) => ({
    externalId,
    balance: Math.round(balance * 100) / 100,
  }));
}
