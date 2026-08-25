/**
 * Коментарі й фото локації клієнта: що торговий знає, чого немає в цифрах.
 *
 * Доступ ширший, ніж у решти карти: писати може й SALES, бо саме він
 * привозить це знання з маршруту. Читати — теж, інакше коментар нікому
 * не допоможе перед візитом.
 *
 * Редагувати й видаляти може лише автор або керівництво: чужий коментар
 * — це чиясь пам'ять про домовленість, і мовчки переписувати її не можна.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Фото локації приймаємо тільки як зображення й не більше 6 МБ.
 *
 * Клієнт стискає знімок перед відправкою (див. ClientCommentsModal), тож
 * реальні файли — сотні кілобайт. Стеля потрібна на випадок, коли стиснути
 * не вдалося: у полі краще відмовити з поясненням, ніж хвилину вантажити
 * п'ятимегабайтний кадр по 3G і впертися в ліміт Vercel.
 */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/**
 * DRIVER тут нарівні з SALES: водій стоїть біля дверей і бачить те, чого
 * не бачить ніхто («заїзд з двору», «після 15:00 зачинено», «вивіска
 * інша»). Стрічка спільна — торговий і водій пишуть в одну.
 */
const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES", "DRIVER"];

/** Хто може правити й видаляти чужі коментарі. */
const MANAGEMENT_ROLES = ["ADMIN", "MANAGER"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!STAFF_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { counterpartyId } = await params;
  const comments = await prisma.clientComment.findMany({
    where: { counterpartyId },
    select: {
      id: true,
      text: true,
      photoUrl: true,
      lat: true,
      lng: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    comments: comments.map((c) => ({
      id: c.id,
      text: c.text,
      photoUrl: c.photoUrl,
      lat: c.lat,
      lng: c.lng,
      createdAt: c.createdAt.toISOString(),
      author: c.author,
      // Явний перелік, а не «не SALES»: із появою DRIVER заперечення тихо
      // роздало б водієві право правити чужі коментарі.
      canEdit:
        c.author.id === session.user.id || MANAGEMENT_ROLES.includes(session.user.role),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!STAFF_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { counterpartyId } = await params;

  /**
   * Два формати тіла в одному роуті.
   *
   * JSON лишається заради вже наявних викликів (адмінка править текст без
   * фото). Фото приходить formData — інакше знімок довелося б переганяти в
   * base64 і роздувати на третину саме там, де зв'язок найгірший.
   */
  const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");

  let text = "";
  let photo: File | null = null;
  let lat: number | null = null;
  let lng: number | null = null;

  if (isForm) {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Не вдалося прочитати форму" }, { status: 400 });
    }
    text = String(form.get("text") ?? "").trim();
    const file = form.get("photo");
    photo = file instanceof File && file.size > 0 ? file : null;
    const rawLat = Number(form.get("lat"));
    const rawLng = Number(form.get("lng"));
    if (Number.isFinite(rawLat) && Number.isFinite(rawLng) && Math.abs(rawLat) <= 90) {
      lat = rawLat;
      lng = rawLng;
    }
  } else {
    const body = await req.json().catch(() => null);
    text = String(body?.text ?? "").trim();
  }

  // Порожній текст дозволено, якщо є фото: знімок воріт сам собою вже
  // відповідь на питання «куди під'їжджати».
  if (!text && !photo) {
    return NextResponse.json({ error: "Порожній коментар" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "Коментар задовгий (макс. 2000 символів)" }, { status: 400 });
  }
  if (photo) {
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
  }

  const client = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  }

  let photoUrl: string | null = null;
  let photoKey: string | null = null;
  if (photo) {
    // Ключ будуємо з id клієнта й автора з СЕСІЇ: підкласти чужу теку через
    // поле форми не вийде.
    photoKey = `client-locations/${counterpartyId}/${session.user.id}-${Date.now()}.${PHOTO_TYPES[photo.type]}`;
    photoUrl = await uploadFile(Buffer.from(await photo.arrayBuffer()), photoKey, photo.type);
  }

  const created = await prisma.clientComment.create({
    data: { counterpartyId, authorId: session.user.id, text, photoUrl, photoKey, lat, lng },
    select: {
      id: true,
      text: true,
      photoUrl: true,
      lat: true,
      lng: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(
    { ...created, createdAt: created.createdAt.toISOString(), canEdit: true },
    { status: 201 }
  );
}
