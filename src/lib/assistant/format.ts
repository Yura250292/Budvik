/**
 * Як факти виглядають для моделі.
 *
 * Ключі українською — так само, як у зведенні для АІ-помічника аналітики
 * (ask/route.ts). Це не косметика: модель відповідає українською, і коли
 * поле зветься «прострочено», вона не мусить вигадувати переклад для
 * `overdue` — а разом із перекладом вигадувати й зміст.
 *
 * Числа приходять сюди вже пораховані. Тут лише округлення: копійки в
 * пораді торговому не значать нічого, а в контексті моделі коштують
 * токенів.
 */

import { TOOL_RESULT_MAX_CHARS } from "@/lib/assistant/config";

/** Гроші — цілими гривнями. */
export const uah = (n: number | null | undefined): number => Math.round(n ?? 0);

/** Відсотки — з одним знаком: більше точності тут удавана. */
export const pct = (n: number | null | undefined): number =>
  n == null || !Number.isFinite(n) ? 0 : Math.round(n * 10) / 10;

/** Дні — цілі. */
export const days = (n: number | null | undefined): number => Math.round(n ?? 0);

/** Дата у вигляді 2026-09-04; null лишається null. */
export function ymd(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Текст із бази, який побачить модель.
 *
 * Нотатки й коментарі пише людина, і в них трапляється що завгодно —
 * зокрема керівні символи, які в JSON-контексті виглядають як сміття.
 * Прибираємо їх і тут же обмежуємо довжину: одна нотатка не має займати
 * половину контексту.
 */
export function humanText(raw: string | null | undefined, max = 300): string {
  if (!raw) return "";
  const clean = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * Результат інструмента → рядок для моделі, що гарантовано влазить у ліміт.
 *
 * Ріжемо МАСИВИ, а не рядок: обрізаний JSON модель або не розбере, або
 * розбере навпіл і почне міркувати про уламок. Тому послідовно
 * зменшуємо найдовші списки вдвічі, поки не влізе, і чесно ставимо
 * позначку «обрізано» — щоб модель не робила висновку «більше немає».
 */
export function compact(value: unknown, max = TOOL_RESULT_MAX_CHARS): string {
  let current = value;
  let json = safeStringify(current);
  if (json.length <= max) return json;

  for (let attempt = 0; attempt < 8 && json.length > max; attempt++) {
    current = halveArrays(current);
    json = safeStringify(current);
  }

  if (json.length > max) {
    // Масиви вже нічого не важать — значить, роздувся окремий об'єкт.
    // Такого бути не мало б, але порожня відповідь гірша за куций JSON.
    return safeStringify({
      помилка: "результат завеликий, звузьте запит (менший період або ліміт)",
    });
  }
  return json;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify({ помилка: "результат не серіалізується" });
  }
}

/** Найдовші масиви — навпіл, із позначкою про обрізання. */
function halveArrays(value: unknown): unknown {
  if (Array.isArray(value)) {
    const keep = Math.max(1, Math.floor(value.length / 2));
    return value.slice(0, keep).map(halveArrays);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let cut = false;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = halveArrays(v);
      if (Array.isArray(v) && Array.isArray(next) && next.length < v.length) cut = true;
      out[k] = next;
    }
    if (cut) out["обрізано"] = true;
    return out;
  }
  return value;
}
