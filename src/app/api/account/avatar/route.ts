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
 *
 * Файл приймаємо СИРИМ тілом, без multipart. 10.09.2026 завантаження падало
 * на `req.formData()` з «no boundary found in multipart body»: до функції
 * долітав заголовок multipart/form-data без boundary, хоча жодна сторінка
 * його руками не ставить — тобто його губила дорога (WebView, проксі,
 * старий бандл у кеші). Одне поле з одним файлом не варте конверта, який
 * може розклеїтись: без boundary немає чому ламатися. Розбір multipart
 * лишено запасним шляхом для вкладок, що досі крутять стару збірку.
 */

/** 2 МБ: аватарка показується кружечком 40-80px, більше не має сенсу. */
const MAX_BYTES = 2 * 1024 * 1024;

type Fail = { error: string; status: number };

const isFail = (v: unknown): v is Fail =>
  typeof v === "object" && v !== null && "error" in v;

const tooBig = (): Fail => ({
  error: `Файл завеликий — максимум ${MAX_BYTES / 1024 / 1024} МБ`,
  status: 400,
});

/**
 * Формат — за першими байтами, а не за словом клієнта.
 *
 * Заголовок від клієнта тут ненадійний двічі: Android віддає порожній тип
 * для HEIC з галереї (файл відкидався як «не зображення»), а підставити
 * чуже значення руками може будь-хто. Байти не брешуть в обидва боки.
 */
function sniffImage(buf: Buffer): { type: string; ext: string } | null {
  if (buf.length < 12) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { type: "image/jpeg", ext: "jpg" };
  }
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { type: "image/png", ext: "png" };
  }
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { type: "image/webp", ext: "webp" };
  }
  // HEIC/HEIF: тип лежить у брендi контейнера ISO-BMFF одразу після "ftyp".
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) {
      return { type: "image/heic", ext: "heic" };
    }
  }

  return null;
}

async function readUpload(req: NextRequest): Promise<Buffer | Fail> {
  const contentType = req.headers.get("content-type") ?? "";

  // Запасний шлях: сторінка зі старої збірки все ще шле multipart.
  if (contentType.startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      // Content-Type у лог навмисно: рівно його бракувало, щоб зрозуміти,
      // чому «no boundary» приходив із запиту, який ніхто так не складав.
      console.error("Avatar: multipart не розібрався", contentType, e);
      return {
        error: "Файл не дійшов цілим. Оновіть сторінку і спробуйте ще раз",
        status: 400,
      };
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

export async function POST(req: NextRequest) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const upload = await readUpload(req).catch((e): Fail => {
    console.error("Avatar: тіло запиту не прочиталось", e);
    return { error: "Файл не дійшов цілим. Спробуйте ще раз", status: 400 };
  });
  if (isFail(upload)) {
    return NextResponse.json({ error: upload.error }, { status: upload.status });
  }

  const kind = sniffImage(upload);
  if (!kind) {
    return NextResponse.json(
      { error: "Підтримуються лише зображення: JPG, PNG, WEBP, HEIC" },
      { status: 400 }
    );
  }

  // id із сесії, не з тіла: інакше можна було б записати файл у чужу теку.
  const key = `avatars/${me.userId}-${Date.now()}.${kind.ext}`;

  // Без catch виняток R2 (немає ключів, бакет недоступний) віддавав би
  // HTML-500, фронт не міг його розібрати і показував загальне
  // «Не вдалося завантажити фото» — причину доводилось шукати в логах.
  try {
    const url = await uploadFile(upload, key, kind.type);

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
