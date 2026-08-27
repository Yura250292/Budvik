import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/r2";
import { resolveIdentity } from "@/lib/app/identity";

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
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

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
  const key = `avatars/${me.userId}-${Date.now()}.${ext}`;

  // Без catch виняток R2 (немає ключів, бакет недоступний) віддавав би
  // HTML-500, фронт не міг його розібрати і показував загальне
  // «Не вдалося завантажити фото» — причину доводилось шукати в логах.
  try {
    const url = await uploadFile(buffer, key, file.type);

    await prisma.user.update({
      where: { id: me.userId },
      data: { avatarUrl: url },
    });

    return NextResponse.json({ avatarUrl: url });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("Avatar upload failed:", detail, e);
    return NextResponse.json(
      { error: `Сховище не прийняло файл: ${detail}` },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  await prisma.user.update({
    where: { id: me.userId },
    data: { avatarUrl: null },
  });

  return NextResponse.json({ ok: true });
}
