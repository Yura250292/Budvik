/**
 * Накладні складу: фото → сховище → розпізнавання → звіт для офісу.
 *
 * Логіка та сама, що в Telegram-боті (budvik-sklad-bot/src/reports.js), але
 * джерело фото інше: бот бере file_id, застосунок шле байти. Усе, що нижче
 * прийому файла, мусить бути ОДНЕ на обидва входи — інакше розпізнане з
 * телефона й розпізнане з бота лягали б у базу по-різному, і звіт офісу
 * залежав би від того, звідки прийшла та сама накладна.
 *
 * ЖОДНОГО запису в ERP. Ні SalesDocument, ні PurchaseOrder, ні LocationStock,
 * ні Product.stock: помилка AI не має права стати документом. Товари
 * зіставляються з довідником лише довідково — щоб офіс бачив, про що мова.
 */

import { createHash } from "crypto";
import type { Prisma, WarehouseReport } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/r2";
import { scanAndMatch, ScanError } from "@/lib/ai/scan-invoice";
import { kyivDayStart, kyivDayEnd, kyivDate } from "@/lib/date/kyiv";

/**
 * Стеля на знімок. Застосунок стискає до ~1600 px (кілька сотень кілобайт),
 * але з галереї може прилетіти й оригінал із камери планшета.
 */
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

/** Скільки разів пробуємо розпізнати, перш ніж визнати накладну невдалою. */
const MAX_ATTEMPTS = 3;

export type IngestResult =
  | { duplicate: true; report: WarehouseReport }
  | { duplicate: false; report: WarehouseReport; buffer: Buffer };

function parseDocDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Кладе фото в сховище й заводить звіт зі статусом PENDING.
 *
 * Спершу файл, потім рядок у базі — не навпаки. Якщо розпізнавання впаде,
 * знімок усе одно лишиться: він і є доказ, що людина накладну сфотографувала,
 * а перезняти її через годину вже нема з чого.
 *
 * Ідемпотентність — по SHA-256 байтів у межах людини. Повторний запит (мережа
 * на складі рветься щодня) не створює другу копію накладної в офісі.
 */
export async function ingestInvoicePhoto(opts: {
  userId: string;
  shiftId?: string | null;
  buffer: Buffer;
  mimeType: string;
  batchId?: string | null;
}): Promise<IngestResult> {
  const { userId, buffer, mimeType } = opts;
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const existing = await prisma.warehouseReport.findUnique({
    where: { userId_photoSha256: { userId, photoSha256: sha256 } },
  });
  if (existing) return { duplicate: true, report: existing };

  const ext = mimeType === "application/pdf" ? "pdf" : mimeType.includes("png") ? "png" : "jpg";
  const key = `warehouse/${userId}/${Date.now()}-${sha256.slice(0, 8)}.${ext}`;
  const photoUrl = await uploadFile(buffer, key, mimeType);

  try {
    const report = await prisma.warehouseReport.create({
      data: {
        userId,
        shiftId: opts.shiftId || null,
        status: "PENDING",
        photoSha256: sha256,
        batchId: opts.batchId || null,
        photoUrl,
        photoKey: key,
        photoMimeType: mimeType,
        photoSize: buffer.length,
      },
    });
    return { duplicate: false, report, buffer };
  } catch (e) {
    // P2002 — два однакові фото приїхали одночасно (застосунок повторив
    // запит, поки перший ще виконувався). Це той самий дубль, просто
    // спійманий базою, а не читанням вище.
    if ((e as { code?: string }).code === "P2002") {
      const found = await prisma.warehouseReport.findUnique({
        where: { userId_photoSha256: { userId, photoSha256: sha256 } },
      });
      if (found) return { duplicate: true, report: found };
    }
    throw e;
  }
}

/**
 * Розпізнає збережений звіт і записує результат.
 *
 * `buffer` передається, коли байти ще в пам'яті після завантаження, — щоб не
 * тягнути щойно покладене фото назад зі сховища.
 */
export async function processReport(
  report: WarehouseReport,
  buffer?: Buffer
): Promise<{ ok: true; report: WarehouseReport } | { ok: false; error: string; willRetry: boolean }> {
  await prisma.warehouseReport.update({
    where: { id: report.id },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });

  try {
    let data = buffer;
    if (!data) {
      const res = await fetch(report.photoUrl);
      if (!res.ok) throw new Error(`Не вдалося прочитати фото: ${res.status}`);
      data = Buffer.from(await res.arrayBuffer());
    }

    const { scanned, items, matchedCounterparty, raw } = await scanAndMatch(
      data.toString("base64"),
      report.photoMimeType || "image/jpeg"
    );

    const itemRows: Prisma.WarehouseReportItemCreateWithoutReportInput[] = (items || []).map(
      (item) => {
        const quantity = Number(item.quantity) || 0;
        const price = Number(item.price) || 0;
        return {
          name: String(item.name || "").slice(0, 500) || "Без назви",
          sku: item.sku ? String(item.sku) : null,
          quantity,
          price,
          unit: item.unit ? String(item.unit) : null,
          lineTotal: quantity * price,
          matchedProductId: item.matched?.id || null,
          matchedProductName: item.matched?.name || null,
          matchedProductPrice: item.matched?.currentPrice ?? null,
        };
      }
    );

    const updated = await prisma.warehouseReport.update({
      where: { id: report.id },
      data: {
        status: "DONE",
        docType: scanned.type || null,
        docNumber: scanned.number || null,
        docDate: parseDocDate(scanned.date),
        counterpartyName: scanned.counterpartyName || null,
        counterpartyCode: scanned.counterpartyCode || null,
        matchedCounterpartyId: matchedCounterparty?.id || null,
        totalAmount: scanned.totalAmount != null ? Number(scanned.totalAmount) : null,
        itemsCount: itemRows.length,
        notes: scanned.notes || null,
        rawResponse: raw ? { text: raw.slice(0, 20000) } : undefined,
        processedAt: new Date(),
        errorMessage: null,
        items: { create: itemRows },
      },
    });

    return { ok: true, report: updated };
  } catch (e) {
    const attempts = (report.attempts || 0) + 1;
    const isLast = attempts >= MAX_ATTEMPTS;
    const message =
      e instanceof ScanError ? e.message : e instanceof Error ? e.message : "Помилка розпізнавання";

    /**
     * Не остання спроба — повертаємо в PENDING, а не у FAILED.
     *
     * Різниця не косметична: PENDING людина може перезапустити кнопкою
     * «Спробувати ще раз», а FAILED каже офісу «цю накладну треба вводити
     * руками». Змішувати ці два стани означало б або марно смикати AI, або
     * втратити накладну через одну хвилину поганого зв'язку.
     */
    await prisma.warehouseReport.update({
      where: { id: report.id },
      data: {
        status: isLast ? "FAILED" : "PENDING",
        errorMessage: message,
        processedAt: isLast ? new Date() : null,
      },
    });

    return { ok: false, error: message, willRetry: !isLast };
  }
}

/**
 * Накладна, яка сама вже не поїде.
 *
 * FAILED — це три невдалі спроби. Але зупинитися можна й у PENDING: після
 * невдалої спроби звіт повертається саме туди, і ніхто в фоні його не
 * перечитує — ні в застосунку, ні в боті. Без цього правила накладна з
 * помилкою назавжди показувалася б як «читається», і людина спокійно йшла б
 * додому, вважаючи, що все доїхало.
 */
function needsAttention(r: { status: string; errorMessage: string | null }): boolean {
  return r.status === "FAILED" || (r.status !== "DONE" && !!r.errorMessage);
}

/** Що складовщик показує офісу за день. Дзеркало /zvit із бота. */
export async function daySummary(userId: string, day?: string) {
  const target = day || kyivDate(new Date());

  const reports = await prisma.warehouseReport.findMany({
    where: { userId, createdAt: { gte: kyivDayStart(target), lte: kyivDayEnd(target) } },
    select: { status: true, errorMessage: true, totalAmount: true, itemsCount: true },
  });

  const done = reports.filter((r) => r.status === "DONE");
  const stuck = reports.filter((r) => needsAttention(r));
  return {
    total: reports.length,
    done: done.length,
    pending: reports.filter(
      (r) => (r.status === "PENDING" || r.status === "PROCESSING") && !needsAttention(r)
    ).length,
    failed: stuck.length,
    totalAmount: done.reduce((s, r) => s + (r.totalAmount || 0), 0),
    itemsCount: done.reduce((s, r) => s + (r.itemsCount || 0), 0),
  };
}

/**
 * Форма звіту для застосунку й кабінету.
 *
 * `rawResponse` і ключ у сховищі назовні не віддаємо: перше — сирий текст
 * моделі на 20 КБ, друге — адреса приватного файла.
 */
export function reportDto(report: WarehouseReport) {
  return {
    id: report.id,
    status: report.status,
    createdAt: report.createdAt,
    docType: report.docType,
    docNumber: report.docNumber,
    docDate: report.docDate,
    counterpartyName: report.counterpartyName,
    counterpartyCode: report.counterpartyCode,
    matchedCounterpartyId: report.matchedCounterpartyId,
    totalAmount: report.totalAmount,
    itemsCount: report.itemsCount,
    notes: report.notes,
    errorMessage: report.errorMessage,
    attempts: report.attempts,
  };
}

export type WarehouseReportDto = ReturnType<typeof reportDto>;
