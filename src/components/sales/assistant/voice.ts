"use client";

/**
 * Голос у помічнику: сказати питання й послухати відповідь.
 *
 * Торговий за кермом не друкує — і саме тоді питання виникають
 * найчастіше: під'їхав до магазину, згадав про борг, поїхав далі.
 *
 * ЩО ТУТ ПРАЦЮЄ, А ЩО НІ. Розпізнавання мовлення в браузері дає Web
 * Speech API, і на Android це вміє САМЕ CHROME. Системний WebView, у
 * якому відкривається кабінет усередині робочої збірки, такого модуля не
 * має взагалі — тому кнопка мікрофона там просто не з'явиться, а не
 * зламається мовчки. Для застосунку потрібен нативний модуль і нова
 * збірка APK; озвучення ж (speechSynthesis) є і у WebView.
 *
 * Мова жорстко українська: помічник відповідає українською, і питання
 * до нього ставлять нею ж. Автовизначення мови на суміші «дріт» і
 * «Somafix» дає гірший результат, ніж явна вказівка.
 */

const LANG = "uk-UA";

type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type WithSpeech = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

function constructor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as WithSpeech;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceInputSupported = (): boolean => constructor() !== null;

/**
 * Створює розпізнавач. `onText` приходить і на проміжних здогадах —
 * так людина бачить, що її чують, і не повторює питання двічі.
 */
export function createRecognition(handlers: {
  onText: (text: string, final: boolean) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}): Recognition | null {
  const Ctor = constructor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = LANG;
  recognition.interimResults = true;
  // Одне питання за раз: безперервний режим у машині ловить радіо й
  // розмову пасажира, і поле саме собою заповнюється сміттям.
  recognition.continuous = false;

  recognition.onresult = (event) => {
    let text = "";
    let final = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      text += result[0]?.transcript ?? "";
      if (result.isFinal) final = true;
    }
    if (text.trim()) handlers.onText(text.trim(), final);
  };
  recognition.onerror = (e) => handlers.onError(e.error);
  recognition.onend = handlers.onEnd;

  return recognition;
}

export const speechOutputSupported = (): boolean =>
  typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Читає відповідь уголос.
 *
 * Розмітку прибираємо: таблиця з чотирьох колонок, прочитана вголос, —
 * це набір чисел без початку й кінця. Лишаються заголовки, речення й
 * пункти списків, тобто те, що людина й хотіла б почути.
 */
export function speak(markdown: string): void {
  if (!speechOutputSupported()) return;
  window.speechSynthesis.cancel();

  const text = plainSpeech(markdown);
  if (!text) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANG;
  utterance.rate = 1.05;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith("uk"));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}

export function plainSpeech(markdown: string): string {
  const lines = markdown.replace(/```[\s\S]*?```/g, "").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Рядок підказок — це кнопки, вголос їх читати нема сенсу.
    if (/^>\s*💬/.test(line)) continue;
    // Роздільник таблиці й рядок заголовків над ним.
    if (/^\|\s*[-: |]+\|?\s*$/.test(line)) continue;
    if (/^\|/.test(line) && /^\|\s*[-: |]+\|?\s*$/.test((lines[i + 1] ?? "").trim())) continue;

    if (/^\|/.test(line)) {
      // «| Оборот | 70 221 ₴ |» → «Оборот — 70 221 гривень»
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      out.push(cells.join(" — "));
      continue;
    }
    out.push(line);
  }

  return out
    .join(". ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`>]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    // Знаки вимовляють словами: «₴» синтезатор або ковтає, або читає
    // «гривня» в називному посеред речення.
    .replace(/\s*₴/g, " гривень")
    .replace(/\s*%/g, " відсотків")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 1200);
}
