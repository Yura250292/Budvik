/**
 * Витягування довідників 1С: номенклатура (товари + групи), контрагенти, склади.
 *
 * Номенклатура в 1С — єдиний довідник, де групи (IsFolder=true) і товари
 * лежать разом. Розділяємо їх тут: групи стають категоріями, решта — товарами.
 *
 * Імена полів у різних конфігураціях відрізняються (Артикул / Код / Артикль),
 * тому скрізь використовується pickField з переліком альтернатив.
 */

import type {
  CategoryRecord,
  CounterpartyRecord,
  ProductRecord,
  WarehouseRecord,
} from "@contract";
import type { ODataClient } from "../odata/client.js";
import type { EntityNames } from "../config.js";

/** Сирий рядок OData — ключі залежать від конфігурації 1С. */
type Row = Record<string, unknown>;

/** Порожній GUID у 1С означає «немає посилання». */
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

function str(row: Row, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function num(row: Row, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = row[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      // 1С може віддавати число рядком з комою як десятковим роздільником.
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function bool(row: Row, ...names: string[]): boolean {
  for (const name of names) {
    if (typeof row[name] === "boolean") return row[name] as boolean;
  }
  return false;
}

/** Ref_Key посилання: порожній GUID трактуємо як відсутність. */
function ref(row: Row, ...names: string[]): string | undefined {
  const value = str(row, ...names);
  return value && value !== EMPTY_GUID ? value : undefined;
}

export interface CatalogResult {
  categories: CategoryRecord[];
  products: ProductRecord[];
}

/** Читає довідник номенклатури й розділяє на групи та товари. */
export async function extractCatalog(
  client: ODataClient,
  entities: EntityNames
): Promise<CatalogResult> {
  const rows = await client.fetchAll<Row>(entities.products);

  const categories: CategoryRecord[] = [];
  const products: ProductRecord[] = [];

  for (const row of rows) {
    const externalId = str(row, "Ref_Key");
    const name = str(row, "Description", "Наименование", "Найменування");
    if (!externalId || !name) continue;

    const deleted = bool(row, "DeletionMark");
    const parentExternalId = ref(row, "Parent_Key");

    if (bool(row, "IsFolder")) {
      categories.push({
        externalId,
        name,
        ...(parentExternalId ? { parentExternalId } : {}),
        ...(deleted ? { deleted } : {}),
      });
      continue;
    }

    products.push({
      externalId,
      name,
      sku: str(row, "Артикул", "Артикль", "Code", "Код"),
      description: str(row, "Комментарий", "Описание", "НаименованиеПолное"),
      categoryExternalId: parentExternalId,
      unit: str(row, "БазоваяЕдиницаИзмерения", "ЕдиницаИзмерения"),
      ...(deleted ? { deleted } : {}),
    });
  }

  return { categories, products };
}

export async function extractCounterparties(
  client: ODataClient,
  entities: EntityNames
): Promise<CounterpartyRecord[]> {
  const rows = await client.fetchAll<Row>(entities.counterparties);
  const records: CounterpartyRecord[] = [];

  for (const row of rows) {
    const externalId = str(row, "Ref_Key");
    const name = str(row, "Description", "Наименование", "Найменування");
    if (!externalId || !name) continue;

    // Групи контрагентів нам не потрібні — лише самі контрагенти.
    if (bool(row, "IsFolder")) continue;

    const isSupplier = bool(row, "Поставщик", "ЭтоПоставщик");
    const isCustomer = bool(row, "Покупатель", "ЭтоПокупатель", "Клиент");

    records.push({
      externalId,
      name,
      code: str(row, "Код", "Code"),
      phone: str(row, "Телефон", "КонтактныйТелефон"),
      email: str(row, "ЭлектроннаяПочта", "Email"),
      address: str(row, "Адрес", "ЮридическийАдрес", "ФактическийАдрес"),
      type: isSupplier && !isCustomer ? "SUPPLIER" : isCustomer && !isSupplier ? "CUSTOMER" : "BOTH",
      ...(bool(row, "DeletionMark") ? { deleted: true } : {}),
    });
  }

  return records;
}

export async function extractWarehouses(
  client: ODataClient,
  entities: EntityNames
): Promise<WarehouseRecord[]> {
  const rows = await client.fetchAll<Row>(entities.warehouses);
  const records: WarehouseRecord[] = [];

  for (const row of rows) {
    const externalId = str(row, "Ref_Key");
    const name = str(row, "Description", "Наименование", "Найменування");
    if (!externalId || !name || bool(row, "IsFolder") || bool(row, "DeletionMark")) continue;

    records.push({ externalId, name, address: str(row, "Адрес", "АдресСклада") });
  }

  return records;
}

export { num, ref, str, bool };
export type { Row };
