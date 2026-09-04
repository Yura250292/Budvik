/**
 * Розпізнавання показань одометра з фото приладової панелі.
 *
 * Порт з /Users/admin/budvik-sklad-bot/src/odometer.js. Промпт і пороги
 * перенесені ДОСЛІВНО — вони вилизані під два реальні збої, які коштували
 * розборів:
 *
 *   1. Модель читала добовий лічильник (TRIP) замість загального (ODO).
 *      Це найчастіша помилка: не «не прочитав», а «прочитав не те».
 *   2. Модель бачила «MPH» біля стрілки спідометра, вирішувала, що
 *      одометр у милях, і 91 300 перетворювалося на 146 936.
 *
 * При зміні промпта тут — оновити й у боті, поки він живий.
 */

import { callGeminiVision } from "@/lib/ai/gemini-vision";

export const ODOMETER_SYSTEM_PROMPT = `Ти — система розпізнавання показань одометра (лічильника пробігу) автомобіля.
Тобі дають фото приладової панелі. Твоє завдання — прочитати ЗАГАЛЬНИЙ пробіг.

Правила:
1. Читай саме ЗАГАЛЬНИЙ пробіг (ODO / TOTAL), а НЕ добовий лічильник (TRIP / TRIP A / TRIP B / DTE).
   Загальний пробіг — це більше число, зазвичай 5-7 цифр і БЕЗ десяткової частини.
   Добовий — менше число, зазвичай з однією цифрою після коми (напр. 123.4).
2. Якщо на панелі видно кілька чисел — обери те, що є загальним пробігом.
3. ЧИТАЙ ЦИФРИ ПООДИНЦЕ, зліва направо, і випиши їх у полі "digitsRead"
   через пробіл — саме так, як вони виглядають на екрані.
   Приклад: якщо на табло "091300", то "digitsRead": "0 9 1 3 0 0", "value": 91300.
   Не вгадуй останні цифри — вони змінюються найчастіше і саме в них
   найлегше помилитися. Якщо якась цифра нечітка — став confidence нижче 0.7.
4. Провідні нулі в "value" не пиши: "091300" → 91300.
5. Поверни ЦІЛЕ число без пробілів і роздільників: 123456, а не "123 456" чи "123,456".
6. Оціни свою впевненість від 0 до 1. Став НИЖЧЕ 0.7, якщо:
   - фото розмите, засвічене або темне;
   - частина цифр перекрита чи обрізана;
   - ти не впевнений, що це саме загальний пробіг, а не добовий;
   - ти не впевнений хоча б в одній цифрі.
7. Якщо прочитати число неможливо — поверни "value": null і поясни причину в "reason".
8. НЕ ВИГАДУЙ число. Краще null, ніж здогадка.

ВАЖЛИВО ПРО ОДИНИЦІ: не звертай уваги на написи MPH / km/h біля стрілки
спідометра — це шкала швидкості, а не одиниці одометра. Просто прочитай
число з табло одометра як є, нічого не перераховуй.

Поверни ТІЛЬКИ валідний JSON, без markdown обгортки:
{
  "value": 91300,
  "digitsRead": "0 9 1 3 0 0",
  "digits": 6,
  "confidence": 0.95,
  "isTripMeter": false,
  "reason": "коротке пояснення українською, якщо value = null або confidence < 0.7"
}`;

export type OdometerRead = {
  value: number | null;
  digitsRead: string | null;
  digits: number | null;
  confidence: number | null;
  isTripMeter: boolean;
  reason: string | null;
};

/**
 * Читає одометр із фото.
 *
 * temperature: 0, а не 0.1 як у накладних — тут одна правильна
 * відповідь, і творчість моделі шкідлива.
 */
/**
 * Підказка з попереднього показання.
 *
 * Найчастіша помилка моделі — не остання цифра, а ПЕРША: у Кулика вона
 * чотири рази прочитала 51047, 752181, 152632 і 155902 замість 351647,
 * 352181, 352632 і 353279. Тобто число правильне з другої цифри, а першу
 * модель або губить, або вигадує. Людина ловила це щоразу, але не тому, що
 * бачила краще — вона просто знала, скільки було вчора.
 *
 * Тепер це знає й модель. Свідомо м'яко: підказка, а не правило, і межа
 * широка (600 км), щоб чесний довгий день не змушував модель підганяти
 * число під очікування.
 */
function rangeHint(previousValue: number | null | undefined): string {
  if (previousValue == null) return "";
  return (
    `\n\nПІДКАЗКА: попереднє показання цього автомобіля — ${previousValue}. ` +
    `Очікуване число зазвичай між ${previousValue} і ${previousValue + 600}, ` +
    `і майже завжди має стільки ж цифр. Якщо прочитане сильно менше — ти, ` +
    `найімовірніше, загубив ПЕРШУ цифру: перевір її окремо. Але НЕ підганяй ` +
    `число під підказку: якщо на табло справді інше — поверни те, що бачиш.`
  );
}

export async function readOdometerImage(
  base64: string,
  mimeType: string,
  opts: { previousValue?: number | null } = {}
): Promise<{ read: OdometerRead; raw: unknown; model: string; usedFallback: boolean }> {
  const out = await callGeminiVision({
    base64,
    mimeType,
    systemPrompt: ODOMETER_SYSTEM_PROMPT + rangeHint(opts.previousValue),
    userText: "Прочитай загальний пробіг (одометр) на цій приладовій панелі.",
    generationConfig: { temperature: 0, maxOutputTokens: 512 },
    label: "odometer",
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonFence(out.rawText));
  } catch {
    throw new Error("AI не зміг прочитати одометр");
  }

  const value =
    typeof parsed.value === "number" && Number.isFinite(parsed.value)
      ? Math.round(parsed.value)
      : null;

  return {
    read: {
      value,
      digitsRead: typeof parsed.digitsRead === "string" ? parsed.digitsRead : null,
      digits: typeof parsed.digits === "number" ? parsed.digits : null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
      isTripMeter: parsed.isTripMeter === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
    },
    raw: parsed,
    model: out.model,
    usedFallback: out.usedFallback,
  };
}

/** Знімає ```json ... ``` обгортку, якщо модель її додала попри інструкцію. */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}
