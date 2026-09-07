/**
 * Накладна з телефона: фото → сховище → розпізнавання → звіт в офіс.
 *
 * Один запит на всю дорогу, а не «завантаж, потім розпізнай». Складовщик
 * стоїть із накладною в руках і чекає відповіді «прочитав, №1245, 12 позицій»
 * — розбивати це на два кроки означало б, що між ними телефон може заснути, і
 * половина накладних лишиться вічно PENDING без жодного винного.
 *
 * ЖОДНОГО запису в ERP — див. src/lib/warehouse/reports.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, WAREHOUSE_ROLES } from "@/lib/app/identity";
import {
  ingestInvoicePhoto,
  processReport,
  reportDto,
  MAX_PHOTO_BYTES,
} from "@/lib/warehouse/reports";
import { getOpenShift } from "@/lib/warehouse/shift";

export const dynamic = "force-dynamic";
/**
 * Розпізнавання накладної на 60 позицій іде довше за типову відповідь: Gemini
 * читає всю таблицю. Стандартних 15 с не вистачає, і роут обривався б рівно на
 * найважчих документах.
 */
export const maxDuration = 120;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;
  const userId = auth.me.userId;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Очікується multipart/form-data" }, { status: 400 });
  }

  const file = form.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Немає фото" }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Фото завелике — зніміть ще раз" }, { status: 400 });
  }

  const mimeType = file.type || "image/jpeg";
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: "Підтримуються фото та PDF" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  /**
   * Зміну шукаємо, але не вимагаємо.
   *
   * Накладна, надіслана поза зміною, — це не помилка, а звичайний ранок, коли
   * зміну забули відкрити. Втратити документ через це було б набагато гірше,
   * ніж мати звіт без прив'язки: shiftId у схемі саме тому й nullable.
   */
  const shift = await getOpenShift(userId).catch(() => null);

  let ingest;
  try {
    ingest = await ingestInvoicePhoto({
      userId,
      shiftId: shift?.id ?? null,
      buffer,
      mimeType,
      batchId: typeof form.get("batchId") === "string" ? String(form.get("batchId")) : null,
    });
  } catch (e) {
    console.error("[warehouse/scan] не вдалося зберегти фото:", e);
    return NextResponse.json({ error: "Не вдалося зберегти фото. Спробуйте ще раз." }, { status: 502 });
  }

  /**
   * Те саме фото вдруге — не другий звіт, а той самий.
   *
   * Але «той самий» не означає «та сама відповідь». Повтор буває двох різних
   * природ, і плутати їх дорого:
   *
   * — накладна вже прочитана: людина просто надіслала фото ще раз, і бачити
   *   вона має перший результат;
   * — накладна НЕ прочиталася: повтор — це і є «спробуй ще раз», і повернути
   *   на нього порожній звіт зі словом «поїхало» означало б збрехати саме там,
   *   де людина перевіряє, чи документ доїхав.
   */
  if (ingest.duplicate && ingest.report.status === "DONE") {
    return NextResponse.json(
      { duplicate: true, report: reportDto(ingest.report) },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  /**
   * Лічильник спроб на повторі обнуляємо: три невдачі поспіль зробили звіт
   * FAILED, і без цього повторне фото падало б одразу, не дійшовши до моделі.
   */
  const target = ingest.duplicate
    ? await prisma.warehouseReport.update({
        where: { id: ingest.report.id },
        data: { attempts: 0, status: "PENDING", errorMessage: null },
      })
    : ingest.report;

  const result = await processReport(target, buffer);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        canRetry: true,
        reportId: ingest.report.id,
      },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { duplicate: false, report: reportDto(result.report) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
