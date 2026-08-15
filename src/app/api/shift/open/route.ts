/**
 * Відкриття зміни: підтверджений одометр стає точкою відліку дня.
 *
 * Заразом лікує вчорашню забуту зміну. Це не побічний ефект, а єдиний
 * момент, коли її взагалі можна закрити чесно: кінцевого фото немає, і
 * єдине реальне число — стартовий одометр сьогоднішньої зміни.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { OdometerSource } from "@prisma/client";
import { verifyDeviceToken, TRACK_ROLES } from "@/lib/track/device-token";
import { autoCloseForgotten, findLastFinished, summarize } from "@/lib/shift/service";

export const dynamic = "force-dynamic";

const SOURCES: OdometerSource[] = ["AI", "MANUAL", "CORRECTED"];

export async function POST(req: NextRequest) {
  const userId = await resolveUser(req);
  if (!userId) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });

  let body: {
    readId?: string;
    odometer?: number;
    source?: string;
    lat?: number;
    lng?: number;
    clientRequestId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const odometer = Number(body.odometer);
  if (!Number.isInteger(odometer) || odometer < 100 || odometer > 2_000_000) {
    return NextResponse.json({ error: "Некоректні показання одометра" }, { status: 400 });
  }

  const source = (body.source ?? "AI").toUpperCase() as OdometerSource;
  if (!SOURCES.includes(source)) {
    return NextResponse.json({ error: "Некоректне джерело" }, { status: 400 });
  }

  /**
   * Повтор того самого запиту після таймауту не має створювати другу
   * зміну. Пристрій генерує ключ один раз при натисканні кнопки, тому
   * ретрай WorkManager безпечний.
   */
  if (body.clientRequestId) {
    const existing = await prisma.shift.findUnique({
      where: { clientRequestId: body.clientRequestId },
    });
    if (existing) {
      return NextResponse.json({ shift: summarize(existing), repeated: true });
    }
  }

  const readRow = body.readId
    ? await prisma.shiftOdometerRead.findUnique({
        where: { id: body.readId },
        select: { id: true, userId: true, photoUrl: true, photoKey: true, photoSha256: true, aiValue: true, aiConfidence: true },
      })
    : null;

  // Чуже розпізнавання підставити не можна.
  if (readRow && readRow.userId !== userId) {
    return NextResponse.json({ error: "Чуже розпізнавання" }, { status: 403 });
  }

  const previous = await findLastFinished(userId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      /**
       * Незакрита вчорашня зміна буває у двох станах:
       *
       *   OPEN — торговий просто забув про неї;
       *   ABANDONED + closedLate — увечері згадав і вказав час, але
       *   одометра тоді сфотографувати не міг.
       *
       * Обидві треба добити стартовим одометром цього ранку: у першої
       * немає ні часу, ні пробігу, у другої — лише пробігу.
       */
      const forgotten = await tx.shift.findFirst({
        where: {
          userId,
          OR: [
            { status: "OPEN" },
            { status: "ABANDONED", closedLate: true, endOdometer: null },
          ],
        },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          startOdometer: true,
          startedAt: true,
          // Якщо зміну вже закрили ввечері «без фото, вказавши час», ми
          // знаємо, скільки з пробігу — вечір: його треба відняти.
          closedLate: true,
          afterWorkKm: true,
          endedAt: true,
        },
      });

      /**
       * Забуту зміну закриваємо ПЕРЕД створенням нової, а не після.
       * Частковий унікальний індекс дозволяє лише одну OPEN на людину,
       * тому створення нової поверх незакритої падало б з P2002 — і
       * найпоширеніший реальний сценарій (забув закрити вчора) не
       * працював би взагалі.
       *
       * autoClosedByShiftId проставляємо другим кроком: id нової зміни
       * ще не існує.
       */
      const forgottenClosed = forgotten
        ? await autoCloseForgotten(tx, forgotten, odometer, null)
        : null;

      const shift = await tx.shift.create({
        data: {
          userId,
          status: "OPEN",
          startOdometer: odometer,
          startOdometerSource: source,
          startOdometerAiValue: readRow?.aiValue ?? null,
          startOdometerConfidence: readRow?.aiConfidence ?? null,
          startPhotoUrl: readRow?.photoUrl ?? null,
          startPhotoKey: readRow?.photoKey ?? null,
          startPhotoSha256: readRow?.photoSha256 ?? null,
          startConfirmedAt: new Date(),
          startLat: typeof body.lat === "number" ? body.lat : null,
          startLng: typeof body.lng === "number" ? body.lng : null,
          clientRequestId: body.clientRequestId ?? null,
          // Кілометри між кінцем минулої зміни й початком цієї. Саме
          // собою це НЕ порушення: дорога додому теж рахується.
          personalKm:
            previous?.endOdometer != null && odometer >= previous.endOdometer
              ? odometer - previous.endOdometer
              : null,
        },
      });

      // Тепер, коли id нової зміни відоме, дописуємо ланцюжок:
      // «цю зміну закрила ось та».
      if (forgottenClosed) {
        await tx.shift.update({
          where: { id: forgottenClosed.id },
          data: { autoClosedByShiftId: shift.id },
        });
      }
      const autoClosed = forgottenClosed;

      // Прив'язуємо розпізнавання до створеної зміни — щоб було видно,
      // з якого саме кадру взялося число.
      if (readRow) {
        await tx.shiftOdometerRead.update({
          where: { id: readRow.id },
          data: { shiftId: shift.id },
        });
      }

      return { shift, autoClosed, forgottenStartedAt: forgotten?.startedAt ?? null };
    });

    return NextResponse.json({
      shift: summarize(result.shift),
      // Якщо вчорашня зміна закрилася сама — застосунок має це показати,
      // інакше людина не зрозуміє, звідки в звіті взявся вчорашній пробіг.
      autoClosed: result.autoClosed
        ? {
            shiftId: result.autoClosed.id,
            distanceKm: result.autoClosed.distanceKm,
            startedAt: result.forgottenStartedAt,
            note: "Попередня зміна не була закрита. Пробіг порахований до старту цієї зміни й включає вечір.",
          }
        : null,
      previous: previous
        ? {
            endOdometer: previous.endOdometer,
            endedAt: previous.endedAt,
            distanceKm: previous.distanceKm,
            personalKm: result.shift.personalKm,
          }
        : null,
    });
  } catch (e) {
    // Частковий унікальний індекс: хтось устиг відкрити зміну між
    // перевіркою і вставкою. Віддаємо наявну як успіх — для людини це
    // те саме, що й нова.
    if ((e as { code?: string }).code === "P2002") {
      const open = await prisma.shift.findFirst({ where: { userId, status: "OPEN" } });
      if (open) return NextResponse.json({ shift: summarize(open), repeated: true });
    }
    throw e;
  }
}

async function resolveUser(req: NextRequest): Promise<string | null> {
  const device = await verifyDeviceToken(req.headers.get("authorization"));
  if (device) return device.userId;
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  if (!TRACK_ROLES.includes(session.user.role)) return null;
  return session.user.id;
}
