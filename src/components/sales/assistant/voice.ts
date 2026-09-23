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

/**
 * Сказати готовий текст і дізнатися, коли договорив.
 *
 * Режиму розмови треба знати момент кінця: мікрофон відкривається знову
 * лише ПІСЛЯ мовлення, інакше він почує самого помічника й прийме його
 * слова за нове питання. Chrome іноді не присилає onend (довга черга,
 * вкладка у фоні) — тоді спрацьовує запас за довжиною тексту.
 */
export function speakText(text: string, onEnd?: () => void): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onEnd?.();
  };
  if (!speechOutputSupported() || !text.trim()) {
    finish();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANG;
  utterance.rate = 1.05;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.startsWith("uk"));
  if (voice) utterance.voice = voice;
  utterance.onend = finish;
  utterance.onerror = finish;
  setTimeout(finish, Math.min(60_000, text.length * 110 + 4_000));
  window.speechSynthesis.speak(utterance);
}

/** Перші речення абзацу — вголос більше двох уже не слухають. */
function firstSentences(text: string, count: number): string {
  return text
    .split(/(?<=[.!?])\s+(?=[А-ЯІЇЄҐA-Z0-9«])/u)
    .slice(0, count)
    .join(" ");
}

/**
 * Що сказати вголос про відповідь — коротко, без таблиць.
 *
 * Рішення власника 23.09.2026: «формує таблицю, але не озвучує її, лише
 * каже, що це за таблиця». Порядок джерел:
 *   1. рядок «🔊 …» — його модель пише саме для голосу (voice у запиті);
 *   2. уточнення — питання й варіанти, бо відповідати на них теж голосом;
 *   3. заголовок + висновок або дві перші плитки + «деталі на екрані» —
 *      так звучать кодові відповіді, які моделі не бачать.
 */
export function spokenSummary(markdown: string): string {
  const say = markdown.match(/^\s*🔊\s*(.+)$/mu)?.[1];
  if (say) return plainSpeech(say).slice(0, 400);

  const title = markdown.match(/^##\s+(.+)$/m)?.[1] ?? "";

  if (/^##\s*🙋/mu.test(markdown)) {
    const question = markdown
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("_"));
    const options = markdown.match(/^>\s*💬\s*(.+)$/mu)?.[1]?.split("·").map((o) => o.trim()) ?? [];
    return plainSpeech(
      [question ?? title, options.length ? `Варіанти: ${options.join(", ")}` : ""].filter(Boolean).join("\n")
    ).slice(0, 400);
  }

  const conclusion = markdown.match(/^###[^\n]*Висновок[^\n]*\n+([\s\S]*?)(?:\n#{2,3}\s|\n```|$)/mu)?.[1];
  let body = conclusion ? firstSentences(conclusion.replace(/\s+/g, " ").trim(), 2) : "";

  if (!body) {
    const kpi = markdown.match(/```budvik-kpi\s*\n([\s\S]*?)```/)?.[1];
    try {
      const items = kpi ? (JSON.parse(kpi) as { items?: Array<{ label: string; value: string }> }).items : null;
      if (items?.length) body = items.slice(0, 2).map((i) => `${i.label} — ${i.value}`).join("; ");
    } catch {
      // зіпсований блок — лишаємо без плиток
    }
  }
  if (!body) {
    const paragraph = markdown
      .replace(/```[\s\S]*?```/g, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !/^(#|\||>|-|\*|_|\d+\.)/.test(l));
    body = paragraph ? firstSentences(paragraph, 2) : "";
  }

  const visual = /^\|/m.test(markdown) || /```budvik-(chart|tree|file)/.test(markdown);
  return plainSpeech([title, body, visual ? "Деталі на екрані." : ""].filter(Boolean).join("\n")).slice(0, 400);
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
    // «рахувати?.» — рядки склеюються крапкою, і вона липне до свого знаку.
    .replace(/([?!:;,])\./g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 1200);
}
