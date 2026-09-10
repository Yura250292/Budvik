/**
 * Фото для повідомлення чату.
 *
 * Завантажується окремо від повідомлення, одразу при виборі: поки людина
 * дописує текст, файл уже їде. Ключ у R2 містить id автора з сесії — саме за
 * ним POST /api/chat/messages перевіряє, що фото пришиває той, хто його
 * заливав. Розмір і пропорції стискає клієнт (1600 px, JPEG): sharp у
 * репозиторії немає, а пережимати на сервері 6 МБ — це час функції.
 *
 * Файл приймаємо СИРИМ тілом, як і аватар: 10.09.2026 завантаження фото
 * профілю падало на `req.formData()` з «no boundary found in multipart body»,
 * хоча конверт складав браузер, а не ми — тобто boundary губила дорога
 * (WebView, проксі, стара збірка в кеші). Одне поле з одним файлом не варте
 * конверта, який може розклеїтись. Розміри, які колись їхали полями форми,
 * тепер у запиті: ?w=&h=. Розбір multipart лишено запасним шляхом для
 * вкладок, що досі крутять стару збірку.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { rateLimit } from "@/lib/shop/rate-limit";
import { uploadFile } from "@/lib/r2";
import { sniffImage } from "@/lib/images/sniff-image";
import { NO_STORE } from "../_shared";

export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024;

type Fail = { error: string; status: number };
const isFail = (v: unknown): v is Fail => typeof v === "object" && v !== null && "error" in v;

const tooBig = (): Fail => ({ error: "Фото завелике — максимум 6 МБ", status: 400 });

async function readUpload(req: Request): Promise<Buffer | Fail> {
  const contentType = req.headers.get("content-type") ?? "";

  // Запасний шлях: сторінка зі старої збірки все ще шле multipart.
  if (contentType.startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      console.error("[chat-upload] multipart не розібрався", contentType, e);
      return { error: "Фото не дійшло цілим. Оновіть сторінку і спробуйте ще раз", status: 400 };
    }
    const file = form.get("file");
    if (!(file instanceof File)) return { error: "Файл не надійшов", status: 400 };
    if (file.size > MAX_BYTES) return tooBig();
    return Buffer.from(await file.arrayBuffer());
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length === 0) return { error: "Файл не надійшов", status: 400 };
  if (body.length > MAX_BYTES) return tooBig();
  return body;
}

export async function POST(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;

  const limit = await rateLimit(`chat-upload:${guard.me.userId}`, 40, 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Забагато фото — зачекайте хвилину" }, { status: 429, ...NO_STORE });
  }

  const upload = await readUpload(req).catch((e): Fail => {
    console.error("[chat-upload] тіло запиту не прочиталось", e);
    return { error: "Фото не дійшло цілим. Спробуйте ще раз", status: 400 };
  });
  if (isFail(upload)) return NextResponse.json({ error: upload.error }, { status: upload.status, ...NO_STORE });

  const kind = sniffImage(upload);
  if (!kind) {
    return NextResponse.json({ error: "Не вдалося обробити фото — спробуйте JPG" }, { status: 400, ...NO_STORE });
  }

  const url = new URL(req.url);
  const dim = (v: string | null) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  const width = dim(url.searchParams.get("w"));
  const height = dim(url.searchParams.get("h"));

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  // id із сесії, не з тіла; hex від randomUUID вкладається в [a-z0-9].
  const key = `chat/${yyyy}/${mm}/${guard.me.userId}-${randomUUID().replace(/-/g, "")}.${kind.ext}`;

  try {
    const stored = await uploadFile(upload, key, kind.type);
    return NextResponse.json(
      { key, url: stored, width, height, bytes: upload.length },
      { status: 201, ...NO_STORE }
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[chat-upload]", detail);
    return NextResponse.json({ error: `Сховище не прийняло файл: ${detail}` }, { status: 500, ...NO_STORE });
  }
}
