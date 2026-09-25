/**
 * Фото або PDF чека до запису журналу.
 *
 * Файл приходить сирим тілом, а не multipart: на Budvik конверт multipart
 * губить boundary дорогою (див. /api/account/avatar). Тип — за першими
 * байтами. Чек лежить у R2 приватно; GET віддає коротке підписане посилання.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteFile, signedUrl, uploadFile } from "@/lib/r2";
import { sniffImage } from "@/lib/images/sniff-image";
import { fleetUser } from "../../../../../common";

export const dynamic = "force-dynamic";

/** Тіло запиту до функції Vercel — до 4,5 МБ; фото сторінка стискає до цього. */
const MAX_BYTES = 4 * 1024 * 1024;

type Ctx = { params: Promise<{ id: string; serviceId: string }> };

function sniffReceipt(buf: Buffer): { type: string; ext: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { type: "application/pdf", ext: "pdf" };
  }
  return sniffImage(buf);
}

async function findService(id: string, serviceId: string) {
  return prisma.vehicleService.findFirst({
    where: { id: serviceId, vehicleId: id },
    select: { id: true, receiptKey: true },
  });
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;
  const { id, serviceId } = await params;

  const row = await findService(id, serviceId);
  if (!row?.receiptKey) return NextResponse.json({ error: "Чека немає" }, { status: 404 });
  return NextResponse.redirect(await signedUrl(row.receiptKey, 300));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;
  const { id, serviceId } = await params;

  const row = await findService(id, serviceId);
  if (!row) return NextResponse.json({ error: "Запис не знайдено" }, { status: 404 });

  const body = Buffer.from(await req.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (body.length === 0) return NextResponse.json({ error: "Файл не надійшов" }, { status: 400 });
  if (body.length > MAX_BYTES) {
    return NextResponse.json({ error: "Файл завеликий — максимум 4 МБ" }, { status: 400 });
  }
  const kind = sniffReceipt(body);
  if (!kind) {
    return NextResponse.json({ error: "Підтримуються фото (JPG, PNG, WEBP, HEIC) і PDF" }, { status: 400 });
  }

  const key = `fleet/${id}/${serviceId}-${Date.now()}.${kind.ext}`;
  try {
    await uploadFile(body, key, kind.type);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("Fleet receipt upload failed:", detail, e);
    return NextResponse.json({ error: `Сховище не прийняло файл: ${detail}` }, { status: 500 });
  }

  await prisma.vehicleService.update({ where: { id: serviceId }, data: { receiptKey: key } });
  if (row.receiptKey) await deleteFile(row.receiptKey).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
