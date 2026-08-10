import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/r2";

/**
 * Фото профілю.
 *
 * Свій ендпоінт, а не /api/upload: той пускає лише ADMIN і MANAGER, а фото
 * має міняти кожен собі. Ключ у R2 будується з id користувача з сесії, тож
 * підмінити чужий файл через тіло запиту не вийде.
 *
 * Старий файл не видаляємо: ключ щоразу новий (timestamp), а R2 дешевий —
 * зате при збої запису в базу лишається робоче попереднє фото.
 */

/** 2 МБ: аватарка показується кружечком 40-80px, більше не має сенсу. */
const MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Файл не надійшов" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Підтримуються лише зображення: JPG, PNG, WEBP" },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Файл завеликий — максимум ${MAX_BYTES / 1024 / 1024} МБ` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = EXT_BY_TYPE[file.type] ?? "jpg";
  // id із сесії, не з формі: інакше можна було б записати файл у чужу теку.
  const key = `avatars/${session.user.id}-${Date.now()}.${ext}`;

  const url = await uploadFile(buffer, key, file.type);

  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatarUrl: url },
  });

  return NextResponse.json({ avatarUrl: url });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { avatarUrl: null },
  });

  return NextResponse.json({ ok: true });
}
