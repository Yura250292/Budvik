/**
 * Розпізнавання мовлення: аудіо з телефона → текст питання.
 *
 * НАВІЩО СЕРВЕР, коли в браузері є Web Speech API. Бо його немає там, де
 * він найпотрібніший: системний WebView на Android, у якому відкривається
 * кабінет усередині робочої збірки, розпізнавання не вміє взагалі.
 * Запис же (`MediaRecorder`) вміє і він — тож голос у застосунку дає саме
 * цей шлях, без нової збірки APK.
 *
 * ПОСТАЧАЛЬНИК ЗМІННИЙ. Формат запиту — Whisper-сумісний, той самий у
 * Groq і в OpenAI, тож перехід коштує двох змінних оточення, а не
 * переписування. За замовчуванням Groq: на короткому питанні він
 * відповідає за секунду, і саме затримка тут вирішує, чи користуватимуться
 * голосом узагалі.
 *
 * АУДІО НЕ ЗБЕРІГАЄТЬСЯ. Файл летить у розпізнавання й зникає разом із
 * запитом: ні місця в сховищі, ні питань про записані розмови.
 */

import { prisma } from "@/lib/prisma";

const URL = process.env.STT_URL || "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = process.env.STT_MODEL || "whisper-large-v3-turbo";
const KEY = process.env.STT_API_KEY;

/** Довше за це — вже не питання, а розмова: не приймаємо. */
export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

const TIMEOUT_MS = 20_000;

/** Скільки чекає підказка-словник, поки її не перечитають із бази. */
const VOCAB_TTL_MS = 60 * 60_000;

let vocabCache: { at: number; value: string } | null = null;

/**
 * Підказка розпізнавачу: наші бренди й слова.
 *
 * Whisper приймає короткий текст-контекст і після нього значно рідше
 * псує власні назви — а псує він саме їх: «Somafix» стає «сома фікс»,
 * «Grösser» — «гросер», і пошук по такому тексту не знаходить нічого.
 * Тримаємо коротко: моделі відведено на підказку близько двохсот
 * токенів, і довший список просто обріжеться посередині.
 */
async function vocabulary(): Promise<string> {
  if (vocabCache && Date.now() - vocabCache.at < VOCAB_TTL_MS) return vocabCache.value;

  let brands: string[] = [];
  try {
    const rows = await prisma.brand.findMany({
      where: { products: { some: { isActive: true } } },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 40,
    });
    brands = rows.map((r) => r.name).filter((n) => n.length <= 18);
  } catch {
    // Без бази підказка лишається загальною — це гірше, але не смертельно.
  }

  const value = [
    "Питання торгового представника компанії Budvik українською.",
    "Бренди:",
    brands.join(", "),
    "Слова: артикул, накладна, залишок, прострочено, дебіторка, маршрут, піна, дріт, круг відрізний.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 900);

  vocabCache = { at: Date.now(), value };
  return value;
}

export type SttResult = { text: string } | { error: string; status: number };

export async function transcribe(file: Blob, filename: string): Promise<SttResult> {
  if (!KEY) return { error: "Розпізнавання не налаштоване: немає ключа STT_API_KEY", status: 503 };
  if (file.size === 0) return { error: "Порожній запис", status: 400 };
  if (file.size > MAX_AUDIO_BYTES) return { error: "Запис задовгий", status: 413 };

  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", MODEL);
  // Мова явно: на суміші українських слів і латинських назв автовизначення
  // інколи вирішує, що це російська, і транслітерує все підряд.
  form.append("language", "uk");
  form.append("temperature", "0");
  form.append("response_format", "json");
  form.append("prompt", await vocabulary());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}` },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      console.error("[stt] відмова", res.status, detail);
      return {
        error: res.status === 429 ? "Забагато запитів — спробуйте за хвилину" : "Не вдалося розпізнати",
        status: res.status === 429 ? 429 : 502,
      };
    }

    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    return text ? { text } : { error: "Нічого не почули", status: 422 };
  } catch (e) {
    console.error("[stt] помилка", e);
    return { error: "Розпізнавання не відповіло", status: 504 };
  } finally {
    clearTimeout(timer);
  }
}
