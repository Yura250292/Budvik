/**
 * Документи реалізації та надходження.
 *
 * Читаються ковзним вікном (config.documents.windowDays): 1С дозволяє
 * виправляти проведені документи заднім числом, тому дивитися лише на нові
 * дати недостатньо — вікно перечитує кілька останніх днів повністю.
 */

import type { DocumentRecord, DocumentItemRecord } from "@contract";
import type { ODataClient } from "../odata/client.js";
import type { AgentConfig } from "../config.js";
import { bool, num, ref, str, type Row } from "./catalog.js";

/** Формат дати для $filter в OData 1С. */
function odataDate(date: Date): string {
  return `datetime'${date.toISOString().slice(0, 19)}'`;
}

function extractItems(row: Row): DocumentItemRecord[] {
  // Таблична частина приходить у полі Товары (рідше — Запасы/Услуги).
  const raw = (row["Товары"] ?? row["Запасы"] ?? row["ТоварыУслуги"]) as Row[] | undefined;
  if (!Array.isArray(raw)) return [];

  const items: DocumentItemRecord[] = [];

  for (const line of raw) {
    const productExternalId = ref(line, "Номенклатура_Key", "Номенклатура");
    const quantity = num(line, "Количество", "Кількість");
    if (!productExternalId || quantity === undefined) continue;

    items.push({
      productExternalId,
      quantity,
      price: num(line, "Цена", "Ціна") ?? 0,
      lineNo: num(line, "LineNumber", "НомерСтроки"),
    });
  }

  return items;
}

async function extractDocuments(
  client: ODataClient,
  entity: string,
  since: Date
): Promise<DocumentRecord[]> {
  const rows = await client.fetchAll<Row>(entity, {
    filter: `Date ge ${odataDate(since)}`,
    expand: "Товары",
  });

  const records: DocumentRecord[] = [];

  for (const row of rows) {
    const externalId = str(row, "Ref_Key");
    const number = str(row, "Number", "Номер");
    const date = str(row, "Date", "Дата");

    if (!externalId || !number || !date) continue;

    records.push({
      externalId,
      number,
      date,
      counterpartyExternalId: ref(row, "Контрагент_Key", "Контрагент", "Клиент_Key"),
      totalAmount: num(row, "СуммаДокумента", "Сумма", "СумаДокумента"),
      posted: bool(row, "Posted", "Проведен"),
      deleted: bool(row, "DeletionMark", "ПометкаУдаления"),
      items: extractItems(row),
    });
  }

  return records;
}

export async function extractSalesDocuments(
  client: ODataClient,
  config: AgentConfig
): Promise<DocumentRecord[]> {
  const since = new Date(Date.now() - config.documents.windowDays * 24 * 60 * 60 * 1000);
  return extractDocuments(client, config.entities.salesDocuments, since);
}

export async function extractPurchaseDocuments(
  client: ODataClient,
  config: AgentConfig
): Promise<DocumentRecord[]> {
  const since = new Date(Date.now() - config.documents.windowDays * 24 * 60 * 60 * 1000);
  return extractDocuments(client, config.entities.purchaseDocuments, since);
}
