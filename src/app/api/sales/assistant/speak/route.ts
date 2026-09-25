/**
 * Текст → голос помічника: сирий звук потоком (PCM 16 біт, 24 кГц, моно).
 *
 * Потоком — бо Gemini синтезує три речення 8 секунд, а перший шматок віддає
 * за 1,4: браузер (tts-player.ts) грає його, поки приходить решта.
 * GET із текстом у `t` — однаковий текст дає однаковий звук, тож браузер
 * кешує відповідь, і привітання «Слухаю.» не платить двічі.
 *
 * 503 — синтез недоступний; клієнт тоді озвучує системним голосом.
 */

import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { rateLimit } from "@/lib/shop/rate-limit";
import { synthesize, TTS_MAX_CHARS, TTS_SAMPLE_RATE, ttsConfigured } from "@/lib/assistant/tts";

export const dynamic = "force-dynamic";
/** Звук іде потоком: 1200 знаків — це хвилина мовлення з синтезом. */
export const maxDuration = 120;

/** Реплік на людину на добу — запобіжник від циклу в інтерфейсі, не економія. */
const DAILY_CAP = 600;

export async function GET(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;
  if (!ttsConfigured()) return new Response(null, { status: 503 });

  const text = (new URL(req.url).searchParams.get("t") ?? "").trim();
  if (!text) return new Response(null, { status: 400 });
  if (text.length > TTS_MAX_CHARS) return new Response(null, { status: 413 });

  const limit = await rateLimit(`assistant:tts:${guard.me.userId}`, DAILY_CAP, 86_400);
  if (!limit.allowed) return new Response(null, { status: 429 });

  const audio = await synthesize(text, req.signal);
  if (!audio) return new Response(null, { status: 503 });

  return new Response(audio, {
    headers: {
      "Content-Type": `audio/L16; rate=${TTS_SAMPLE_RATE}; channels=1`,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
