/**
 * Розпізнавання фото одометра — крок перед відкриттям/закриттям зміни.
 *
 * Свідомо НЕ створює зміну. Торговий може перефотографувати панель
 * тричі, поки не вийде читабельний кадр, і кожен кадр має лишити слід
 * (ShiftOdometerRead), але зміна має створитися рівно одна — на кроці
 * підтвердження. Інакше перезнімання плодило б порожні зміни.
 *
 * Фото лягає в R2 ДО розпізнавання: воно вже точно не зміниться, а якщо
 * AI впаде — знімок лишиться доказом, що людина його зробила.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/r2";
import { verifyDeviceToken, TRACK_ROLES } from "@/lib/track/device-token";
import { readOdometerImage } from "@/lib/odometer/recognize";
import { validateOdometer, verdictMessage } from "@/lib/odometer/validate";

export const dynamic = "force-dynamic";

/** Стеля на знімок: застосунок стискає до ~400 КБ, 8 МБ — уже не фото панелі. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const userId = await resolveUser(req);
  if (!userId) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Очікується multipart/form-data" }, { status: 400 });
  }

  const file = form.get("photo");
  const phase = String(form.get("phase") ?? "").toUpperCase();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Немає фото" }, { status: 400 });
  }
  if (phase !== "START" && phase !== "END") {
    return NextResponse.json({ error: "phase має бути START або END" }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Фото завелике" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const mimeType = file.type || "image/jpeg";

  /**
   * Точка відліку для перевірки правдоподібності.
   *
   * При закритті це стартовий одометр цієї ж зміни — від нього рахується
   * пробіг. При відкритті — кінцевий одометр попередньої зміни, і
   * різниця показує, скільки накатано між змінами (особисті кілометри).
   */
  const openShift = await prisma.shift.findFirst({
    where: { userId, status: "OPEN" },
    select: { id: true, startOdometer: true, startedAt: true },
  });

  const lastClosed = await prisma.shift.findFirst({
    where: { userId, status: { in: ["CLOSED", "ABANDONED"] }, endOdometer: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { id: true, endOdometer: true, endedAt: true },
  });

  const previousValue =
    phase === "END" ? (openShift?.startOdometer ?? null) : (lastClosed?.endOdometer ?? null);

  // Фото — у сховище одразу, окремою текою на людину й місяць.
  const month = new Date().toISOString().slice(0, 7);
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const photoKey = `odometer/${userId}/${month}/${Date.now()}-${sha256.slice(0, 8)}.${ext}`;

  let photoUrl: string | null = null;
  try {
    photoUrl = await uploadFile(buffer, photoKey, mimeType);
  } catch (e) {
    console.error("[odometer] не вдалося зберегти фото:", e);
    // Не блокуємо: розпізнати можна й без сховища, а зміну важливіше
    // відкрити, ніж зберегти картинку.
  }

  let read;
  let raw: unknown = null;
  try {
    const out = await readOdometerImage(buffer.toString("base64"), mimeType);
    read = out.read;
    raw = out.raw;
  } catch (e) {
    // Запис про невдачу все одно лишаємо: за ним видно, скільки разів
    // людина перезнімала і чи винен у цьому AI.
    await prisma.shiftOdometerRead.create({
      data: {
        userId,
        shiftId: phase === "END" ? (openShift?.id ?? null) : null,
        phase,
        photoUrl,
        photoKey: photoUrl ? photoKey : null,
        photoSha256: sha256,
        rejectedReason: "ai_failed",
      },
    });
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "AI не зміг прочитати одометр",
        canRetry: true,
        canEnterManually: true,
        photoKey: photoUrl ? photoKey : null,
        photoUrl,
        photoSha256: sha256,
      },
      { status: 422 }
    );
  }

  const verdict = validateOdometer(read, {
    previousValue,
    isClosing: phase === "END",
  });

  const readRow = await prisma.shiftOdometerRead.create({
    data: {
      userId,
      shiftId: phase === "END" ? (openShift?.id ?? null) : null,
      phase,
      photoUrl,
      photoKey: photoUrl ? photoKey : null,
      photoSha256: sha256,
      aiValue: read.value,
      aiConfidence: read.confidence,
      aiDigitsRead: read.digitsRead,
      aiIsTripMeter: read.isTripMeter,
      rejectedReason: verdict.reason,
      rawJson: raw as never,
    },
    select: { id: true },
  });

  return NextResponse.json({
    readId: readRow.id,
    photoKey: photoUrl ? photoKey : null,
    photoUrl,
    photoSha256: sha256,
    ai: {
      value: read.value,
      confidence: read.confidence,
      // Цифри поодинці: за ними людина одразу бачить, де модель схибила
      digitsRead: read.digitsRead,
      isTripMeter: read.isTripMeter,
      reason: read.reason,
    },
    verdict: {
      ok: verdict.ok,
      reason: verdict.reason,
      message: verdictMessage(verdict),
      warnings: verdict.warnings,
      deltaKm: verdict.deltaKm,
    },
    context: {
      hasOpenShift: openShift != null,
      startOdometer: openShift?.startOdometer ?? null,
      startedAt: openShift?.startedAt ?? null,
      previousEndOdometer: lastClosed?.endOdometer ?? null,
      previousEndedAt: lastClosed?.endedAt ?? null,
    },
  });
}

/** Bearer-токен пристрою або cookie — щоб можна було тестувати з браузера. */
async function resolveUser(req: NextRequest): Promise<string | null> {
  const device = await verifyDeviceToken(req.headers.get("authorization"));
  if (device) return device.userId;

  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  if (!TRACK_ROLES.includes(session.user.role)) return null;
  return session.user.id;
}
