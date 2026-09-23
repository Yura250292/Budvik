/**
 * Режим розмови: питання голосом без кнопок, коротка відповідь уголос,
 * таблиці — на екрані, і знову слухаю.
 *
 * Рішення власника 23.09.2026: «даю питання голосом, він каже ось і формує
 * таблицю, але не озвучує її, лише каже, що це за таблиця, і лишається
 * онлайн — я можу питати ще». Голова та сама, що в текстовому помічнику:
 * ті самі інструменти, та сама розмова (продовження «а в Кулика?» працює).
 *
 * ЯК ВІН ЧУЄ КІНЕЦЬ ФРАЗИ. Мікрофон відкривається один раз на всю розмову,
 * а рівень звуку міряється 16 разів на секунду. Голосніше за фоновий шум у
 * 3 рази — людина говорить, запис почався; 1,1 с тиші — фраза закінчилась,
 * запис іде в розпізнавання (той самий роут, що й кнопка мікрофона: словник
 * брендів, Groq). Фон підлаштовується сам — у кабінеті й у машині він різний.
 *
 * ЧОМУ НЕ ПЕРЕБИВАЄ ГОЛОСОМ. Поки помічник говорить, мікрофон глухий:
 * голос синтезатора йде з тих самих динаміків, і браузерний шумодав його не
 * гасить — помічник почув би себе й поставив би собі ж власну відповідь як
 * питання. Перебити можна дотиком до панелі.
 *
 * Аудіо ніде не зберігається: як і з кнопкою, летить у розпізнавання й зникає.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { micErrorText, openMic, recorderSupported } from "./mic";
import { speakText, spokenSummary, stopSpeaking } from "./voice";

export type ConversationState = "off" | "listening" | "hearing" | "recognizing" | "thinking" | "speaking";

/** «Дякую», «стоп», «все» — цілою фразою, а не словом усередині питання. */
const STOP_RE = /^(дякую|спасибі|стоп|досить|все|усе|вистачить|кінець|закінчили|завершити|вимкнись)[\s.!,]*$/i;

const TICK_MS = 60;
/** Скільки тиші після мовлення вважати кінцем фрази. */
const END_SILENCE_MS = 1_100;
/** Коротше — кашель чи стук, а не питання. */
const MIN_SPEECH_MS = 350;
/** Найдовше питання. Далі запис обривається й іде як є. */
const MAX_SPEECH_MS = 30_000;
/** Стільки тиші без жодного питання — розмову закінчено. */
const IDLE_END_MS = 90_000;
/** Коли вимовити назву кроку («Дивлюся дебіторку…»), щоб не мовчати. */
const FILLER_AFTER_MS = 2_500;

function pickMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
}

export function useConversation(opts: {
  /** Поставити питання — те саме, що натиснути «надіслати». */
  ask: (text: string) => void;
  /** Хід ще йде. */
  busy: boolean;
  /** Остання готова відповідь помічника. */
  lastAnswer: { id: string; content: string } | null;
  /** Текст помилки ходу, якщо він упав. */
  failure: string | null;
  /** Що помічник зараз робить — назва кроку для «не мовчати». */
  toolLabel: string | null;
}) {
  const [state, setStateRaw] = useState<ConversationState>("off");
  const [heard, setHeard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef<ConversationState>("off");
  const setState = useCallback((next: ConversationState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  const floor = useRef(0.01);
  const speechStart = useRef(0);
  const lastLoud = useRef(0);
  const idleSince = useRef(0);
  /** Що було останньою відповіддю й помилкою, коли питання пішло. */
  const askedAfter = useRef<{ answerId: string | null; failure: string | null; at: number } | null>(null);
  const fillerSaid = useRef(false);

  const backToListening = useCallback(() => {
    if (stateRef.current === "off") return;
    idleSince.current = Date.now();
    setState("listening");
  }, [setState]);

  /**
   * Договорив — слухаємо, але не миттєво: хвіст синтезатора й луна кімнати
   * ще долітають до мікрофона, і без паузи помічник почув би власне «…на
   * екрані» як початок нового питання.
   */
  const listenAfterSpeech = useCallback(() => {
    setTimeout(() => {
      if (stateRef.current === "speaking") backToListening();
    }, 300);
  }, [backToListening]);

  const end = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    void audio.current?.close().catch(() => {});
    audio.current = null;
    analyser.current = null;
    askedAfter.current = null;
    stopSpeaking();
    setHeard(null);
    setState("off");
  }, [setState]);

  useEffect(() => () => end(), [end]);

  const recognize = useCallback(
    async (blob: Blob, mime: string) => {
      setState("recognizing");
      const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("audio", blob, `voice.${ext}`);
      form.append("name", `voice.${ext}`);
      let text = "";
      try {
        const res = await fetch("/api/sales/assistant/voice", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Не вдалося розпізнати");
          backToListening();
          return;
        }
        text = (data.text ?? "").trim();
      } catch {
        setError("Немає звʼязку — кажіть ще раз");
        backToListening();
        return;
      }
      if (stateRef.current === "off") return;
      // Розпізнавач на тиші любить «Дякую за перегляд» — одне-два слова без сенсу відкидаємо.
      if (text.replace(/[^\p{L}\d]/gu, "").length < 3) {
        backToListening();
        return;
      }
      setHeard(text);
      if (STOP_RE.test(text)) {
        // Спершу закрити мікрофон (end глушить мовлення), потім попрощатись.
        end();
        speakText("Гаразд, до звʼязку.");
        return;
      }
      setError(null);
      askedAfter.current = {
        answerId: optsRef.current.lastAnswer?.id ?? null,
        failure: optsRef.current.failure,
        at: Date.now(),
      };
      fillerSaid.current = false;
      setState("thinking");
      optsRef.current.ask(text);
    },
    [backToListening, end, setState]
  );

  const startRecorder = useCallback(() => {
    const stream = mic.current;
    if (!stream) return;
    const mime = pickMime();
    const instance = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    discard.current = false;
    instance.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    instance.onstop = () => {
      if (discard.current || stateRef.current === "off") return;
      const type = instance.mimeType || mime || "audio/webm";
      void recognize(new Blob(chunks.current, { type }), type);
    };
    recorder.current = instance;
    instance.start();
  }, [recognize]);

  const tick = useCallback(() => {
    const node = analyser.current;
    if (!node) return;
    const data = new Float32Array(node.fftSize);
    node.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = Math.sqrt(sum / data.length);
    const now = Date.now();
    const threshold = Math.max(0.02, floor.current * 3);

    if (stateRef.current === "listening") {
      if (rms > threshold) {
        speechStart.current = now;
        lastLoud.current = now;
        startRecorder();
        setState("hearing");
        return;
      }
      // Фон повільно тягнеться за тишею: кондиціонер, дорога, вентилятор ноутбука.
      floor.current = Math.min(0.08, floor.current * 0.95 + rms * 0.05);
      if (now - idleSince.current > IDLE_END_MS) end();
      return;
    }

    if (stateRef.current === "hearing") {
      if (rms > threshold * 0.7) lastLoud.current = now;
      const spoke = lastLoud.current - speechStart.current;
      if (now - lastLoud.current > END_SILENCE_MS || now - speechStart.current > MAX_SPEECH_MS) {
        if (spoke < MIN_SPEECH_MS) {
          discard.current = true;
          if (recorder.current?.state === "recording") recorder.current.stop();
          backToListening();
          return;
        }
        if (recorder.current?.state === "recording") recorder.current.stop();
        setState("recognizing");
      }
    }
  }, [backToListening, end, setState, startRecorder]);

  const start = useCallback(async () => {
    setError(null);
    setHeard(null);
    if (!recorderSupported()) {
      setError("Тут немає запису звуку — розмова недоступна");
      return;
    }
    try {
      mic.current = await openMic({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    } catch (e) {
      setError(micErrorText(e));
      return;
    }
    // Контекст звуку створюється в натисканні — поза ним браузер тримає його на паузі.
    const ctx = new AudioContext();
    const node = ctx.createAnalyser();
    node.fftSize = 1024;
    ctx.createMediaStreamSource(mic.current).connect(node);
    audio.current = ctx;
    analyser.current = node;
    floor.current = 0.01;
    idleSince.current = Date.now();
    ticker.current = setInterval(tick, TICK_MS);
    setState("speaking");
    speakText("Слухаю.", listenAfterSpeech);
  }, [setState, tick, listenAfterSpeech]);

  /** Дотик до панелі: замовкнути й слухати. */
  const interrupt = useCallback(() => {
    if (stateRef.current !== "speaking") return;
    stopSpeaking();
    backToListening();
  }, [backToListening]);

  /* Хід закінчився — кажемо коротко й знову слухаємо. */
  useEffect(() => {
    if (state !== "thinking" || opts.busy || !askedAfter.current) return;
    const before = askedAfter.current;
    const answered = opts.lastAnswer && opts.lastAnswer.id !== before.answerId;
    const failed = opts.failure && opts.failure !== before.failure;
    if (!answered && !failed) return;
    const text = failed ? `Не вийшло. ${opts.failure}` : spokenSummary(opts.lastAnswer!.content);
    // Стан міняємо поза тілом ефекту — так його й чекає React. Позначку
    // «питання в дорозі» знімаємо теж тут: якщо ефект перезапуститься до
    // таймера, наступний запуск має знайти її й договорити.
    const timer = setTimeout(() => {
      if (stateRef.current !== "thinking" || !askedAfter.current) return;
      askedAfter.current = null;
      setState("speaking");
      speakText(text || "Готово, дивіться на екрані.", listenAfterSpeech);
    }, 0);
    return () => clearTimeout(timer);
  }, [state, opts.busy, opts.lastAnswer, opts.failure, setState, listenAfterSpeech]);

  /* Довгий хід — вимовити, що робимо, щоб тиша не здавалась зависанням. */
  useEffect(() => {
    if (state !== "thinking" || !opts.toolLabel || fillerSaid.current) return;
    const at = askedAfter.current?.at ?? 0;
    const wait = Math.max(0, FILLER_AFTER_MS - (Date.now() - at));
    const timer = setTimeout(() => {
      if (stateRef.current !== "thinking" || fillerSaid.current || !optsRef.current.toolLabel) return;
      fillerSaid.current = true;
      speakText(`${optsRef.current.toolLabel.replace(/…$/, "")}.`);
    }, wait);
    return () => clearTimeout(timer);
  }, [state, opts.toolLabel]);

  return { state, heard, error, start, end, interrupt, supported: recorderSupported() };
}
