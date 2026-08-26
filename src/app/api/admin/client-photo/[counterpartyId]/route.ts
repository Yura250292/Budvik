/**
 * Фото магазину: як клієнт виглядає з вулиці.
 *
 * Окремо від стрічки нотаток (/api/admin/client-comments) навмисно. Там
 * потік спостережень на дату, тут одне поточне фото, за яким упізнають
 * місце. Змішувати їх означало б, що на картці показується останній
 * знімок — а ним однаково часто виявляється кадр піддону чи накладної.
 *
 * Замінити може будь-хто зі штату, і це свідомо: свіже фото майже завжди
 * корисніше за старе, а магазин міг перефарбуватись або змінити вивіску.
 * Хто і коли зняв — зберігаємо, тож питання «звідки це фото» відповідальне.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile, deleteFile } from "@/lib/r2";

export const dynamic = "force-dynamic";

/** Ті самі межі, що для знімків у нотатках: клієнт стискає перед відправкою. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Водій нарівні з торговим: він під'їжджає першим і бачить фасад. */
const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES", "DRIVER"];

async function staff() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !STAFF_ROLES.includes(session.user.role)) return null;
  return session.user;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const user = await staff();
  if (!user) return NextResponse.json({ error: "Немає доступу" }, { status: 403 });

  const { counterpartyId } = await params;

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  const photo = file instanceof File && file.size > 0 ? file : null;
  if (!photo) {
    return NextResponse.json({ error: "Немає фото" }, { status: 400 });
  }
  if (!PHOTO_TYPES[photo.type]) {
    return NextResponse.json(
      { error: "Фото має бути зображенням: JPG, PNG, WEBP або HEIC" },
      { status: 400 }
    );
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: `Фото завелике — максимум ${MAX_PHOTO_BYTES / 1024 / 1024} МБ` },
      { status: 400 }
    );
  }

  const client = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true, photoKey: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  }

  // Ключ складаємо з id клієнта й автора з СЕСІЇ: підкласти чужу теку
  // через поле форми не вийде.
  const key = `client-shops/${counterpartyId}/${user.id}-${Date.now()}.${PHOTO_TYPES[photo.type]}`;
  const url = await uploadFile(Buffer.from(await photo.arrayBuffer()), key, photo.type);

  const updated = await prisma.counterparty.update({
    where: { id: counterpartyId },
    data: { photoUrl: url, photoKey: key, photoAt: new Date(), photoById: user.id },
    select: { photoUrl: true, photoAt: true },
  });

  /**
   * Старий файл прибираємо ПІСЛЯ успішного запису, а не до нього: якщо
   * оновлення впаде, у клієнта лишиться робоче фото, а не порожнє поле й
   * видалений файл. Помилку прибирання ковтаємо — вона не має валити
   * запит, заради якого людина стояла під магазином.
   */
  if (client.photoKey && client.photoKey !== key) {
    await deleteFile(client.photoKey).catch(() => {});
  }

  return NextResponse.json({
    photoUrl: updated.photoUrl,
    photoAt: updated.photoAt?.toISOString() ?? null,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const user = await staff();
  if (!user) return NextResponse.json({ error: "Немає доступу" }, { status: 403 });

  const { counterpartyId } = await params;
  const client = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true, photoKey: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  }

  await prisma.counterparty.update({
    where: { id: counterpartyId },
    data: { photoUrl: null, photoKey: null, photoAt: null, photoById: null },
  });
  if (client.photoKey) await deleteFile(client.photoKey).catch(() => {});

  return NextResponse.json({ ok: true });
}
