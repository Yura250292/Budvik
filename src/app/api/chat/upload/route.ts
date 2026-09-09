/**
 * Фото для повідомлення чату.
 *
 * Завантажується окремо від повідомлення, одразу при виборі: поки людина
 * дописує текст, файл уже їде. Ключ у R2 містить id автора з сесії — саме за
 * ним POST /api/chat/messages перевіряє, що фото пришиває той, хто його
 * заливав. Розмір і пропорції стискає клієнт (1600 px, JPEG): sharp у
 * репозиторії немає, а пережимати на сервері 6 МБ — це час функції.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { rateLimit } from "@/lib/shop/rate-limit";
import { uploadFile } from "@/lib/r2";
import { NO_STORE } from "../_shared";

export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;

  const limit = await rateLimit(`chat-upload:${guard.me.userId}`, 40, 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Забагато фото — зачекайте хвилину" }, { status: 429, ...NO_STORE });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Файл не надійшов" }, { status: 400, ...NO_STORE });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не надійшов" }, { status: 400, ...NO_STORE });
  }
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Не вдалося обробити фото — спробуйте JPG" },
      { status: 400, ...NO_STORE }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Фото завелике — максимум 6 МБ" }, { status: 400, ...NO_STORE });
  }

  const dim = (v: FormDataEntryValue | null) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  const width = dim(form.get("width"));
  const height = dim(form.get("height"));

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  // id із сесії, не з форми; hex від randomUUID вкладається в [a-z0-9].
  const key = `chat/${yyyy}/${mm}/${guard.me.userId}-${randomUUID().replace(/-/g, "")}.${ext}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadFile(buffer, key, file.type);
    return NextResponse.json({ key, url, width, height, bytes: file.size }, { status: 201, ...NO_STORE });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[chat-upload]", detail);
    return NextResponse.json({ error: `Сховище не прийняло файл: ${detail}` }, { status: 500, ...NO_STORE });
  }
}
