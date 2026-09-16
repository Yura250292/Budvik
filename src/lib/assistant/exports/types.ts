/**
 * Вивантаження помічника: таблиця даних, з якої будується xlsx, xlsx для 1С
 * або PDF.
 *
 * Один проміжний формат на три виходи — з тієї ж причини, що й у ранковому
 * зведенні (digest.ts): факти збираються один раз, а малюють їх різні
 * будівники. Інакше Excel і PDF одного звіту розійшлися б у колонках з
 * першої ж правки.
 */

/** money — суми (у PDF без копійок), price — ціна одиниці (з копійками). */
export type ColumnKind = "text" | "int" | "decimal" | "money" | "price" | "percent" | "date";

export type ExportColumn = {
  key: string;
  header: string;
  kind?: ColumnKind;
  /** Ширина в Excel, символів. */
  width?: number;
  /** false — лише в Excel: GUID 1С на папері тільки забирає місце. */
  pdf?: boolean;
};

export type RowTone = "urgent" | "warn" | null;

export type ExportSheet = {
  name: string;
  columns: ExportColumn[];
  rows: Array<Record<string, string | number | null>>;
  /** Підсвітка рядків: червоне — терміново, жовте — мало. Паралельно rows. */
  tones?: RowTone[];
};

export type ExportDataset = {
  /** Коротка назва — і файла, і заголовка. */
  title: string;
  /** Період, бренд, дата формування. */
  subtitle: string;
  /** 2–5 рядків підсумку над таблицею. */
  summary: string[];
  sheets: ExportSheet[];
  /** Застереження під таблицею: звідки дані й чого в них немає. */
  notes: string[];
  /**
   * Рядки заявки для 1С — лише в наборів, де є що завантажувати документом
   * (заявка постачальнику). Інші формат xlsx_1c не підтримують.
   */
  oneC?: Array<{ guid: string | null; sku: string | null; name: string; qty: number; price: number | null }>;
};

export type ExportFormat = "xlsx" | "xlsx_1c" | "pdf";

export const FORMAT_META: Record<ExportFormat, { ext: string; mime: string; label: string }> = {
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel" },
  xlsx_1c: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel для 1С" },
  pdf: { ext: "pdf", mime: "application/pdf", label: "PDF" },
};

/** Стеля рядків: Excel тягне й більше, але хід помічника обмежений у часі. */
export const XLSX_MAX_ROWS = 5_000;
/** PDF на тисячу рядків — це вже 25 сторінок; довше ніхто не гортає. */
export const PDF_MAX_ROWS = 1_000;
