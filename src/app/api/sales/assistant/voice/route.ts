/**
 * Аудіо → текст питання.
 *
 * Окремий роут, а не частина ходу помічника: розпізнане треба показати
 * людині ДО відправки. Прізвища й артикули розпізнавач плутає, і питання
 * з помилкою коштувало б цілого ходу моделі — а так торговий бачить
 * текст у полі й виправляє одним дотиком.
 */

import { NextResponse } from "next/server";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { MAX_AUDIO_BYTES, transcribe } from "@/lib/assistant/stt";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Немає запису" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Запис задовгий" }, { status: 413 });
  }

  const name = typeof form?.get("name") === "string" ? String(form.get("name")) : "voice.webm";
  const result = await transcribe(file, name);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ text: result.text }, { headers: { "Cache-Control": "no-store" } });
}
