/**
 * Де лежить сформований файл і як його віддати.
 *
 * R2, ключ `assistant/exports/<userId>/<uuid>`. Бакет публічний (фото
 * товарів), тож захист — не в секретності адреси, а в тому, що публічної
 * адреси ми не показуємо ніде: файл віддає свій роут
 * (/api/sales/assistant/files/[id]), який збирає ключ із id ПОТОЧНОГО
 * користувача. Чужий файл за своїм id просто не знайдеться. Той самий
 * підхід, що в записах нарад (lib/meetings/keys.ts).
 *
 * Назва файла їде в метаданих об'єкта — окремої таблиці не треба, а
 * зберігати файли вічно ніхто не збирається: правило життєвого циклу R2 на
 * цей префікс (30 днів) ставиться в панелі Cloudflare.
 */

import { randomUUID } from "node:crypto";
import { getFile, uploadFile } from "@/lib/r2";
import { FORMAT_META, type ExportFormat } from "@/lib/assistant/exports/types";

const PREFIX = "assistant/exports";

export const exportKey = (userId: string, fileId: string) => `${PREFIX}/${userId}/${fileId}`;

export const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const fileUrl = (fileId: string) => `/api/sales/assistant/files/${fileId}`;

/** «Що замовити — APRO» → «Що_замовити_APRO_16.09.2026.xlsx». */
export function fileName(title: string, format: ExportFormat, day: string): string {
  const base = title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/[—–-]+/g, " ")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
  const suffix = format === "xlsx_1c" ? "_для_1С" : "";
  return `${base}${suffix}_${day.split("-").reverse().join(".")}.${FORMAT_META[format].ext}`;
}

export async function saveExport(input: {
  userId: string;
  buffer: Buffer;
  format: ExportFormat;
  name: string;
  rows: number;
}) {
  const id = randomUUID();
  await uploadFile(input.buffer, exportKey(input.userId, id), FORMAT_META[input.format].mime, {
    metadata: { name: encodeURIComponent(input.name), format: input.format, rows: String(input.rows) },
    signal: AbortSignal.timeout(15_000),
  });
  return { id, url: fileUrl(id), name: input.name, format: input.format, rows: input.rows, sizeKb: Math.max(1, Math.round(input.buffer.length / 1024)) };
}

export async function loadExport(userId: string, fileId: string) {
  if (!FILE_ID_RE.test(fileId)) return null;
  const file = await getFile(exportKey(userId, fileId));
  if (!file) return null;
  let name = "file";
  try {
    name = decodeURIComponent(file.metadata.name ?? "file");
  } catch {
    // зіпсовані метадані — віддаємо з простою назвою
  }
  return { body: file.body, contentType: file.contentType, name };
}
