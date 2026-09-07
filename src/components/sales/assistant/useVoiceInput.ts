"use client";

/**
 * Голосове питання: два шляхи до одного результату.
 *
 * ПЕРШИЙ — запис і розпізнавання на сервері. Працює скрізь, де браузер
 * уміє `MediaRecorder`, включно з WebView робочої збірки, і знає наші
 * бренди: серверу разом із аудіо їде словник (див. lib/assistant/stt.ts).
 *
 * ДРУГИЙ — розпізнавання самим браузером (Web Speech API). Безкоштовне й
 * миттєве, але є лише в Chrome і про «Somafix» не чуло.
 *
 * Порядок саме такий: якість назв важливіша за миттєвість, бо питання з
 * покаліченим артикулом однаково доведеться перепитувати. Якщо сервер
 * відповідає «не налаштовано», перемикаємось на браузер і більше туди не
 * стукаємо — до перезавантаження сторінки.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createRecognition, voiceInputSupported } from "./voice";

export type VoiceState = "idle" | "listening" | "sending";

const recorderSupported = () =>
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof MediaRecorder !== "undefined";

/** Формат, який приймає і браузер, і розпізнавач. */
function pickMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
}

export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const browserRecognition = useRef<ReturnType<typeof createRecognition>>(null);
  const serverOff = useRef(false);

  const canRecord = recorderSupported();
  const canBrowser = voiceInputSupported();
  const supported = canRecord || canBrowser;

  const stopEverything = useCallback(() => {
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    browserRecognition.current?.abort();
    browserRecognition.current = null;
  }, []);

  useEffect(() => () => stopEverything(), [stopEverything]);

  /** Розпізнавання браузером — запасний шлях. */
  const startBrowser = useCallback(() => {
    const instance = createRecognition({
      onText: (text) => onText(text),
      onEnd: () => {
        setState("idle");
        browserRecognition.current = null;
      },
      onError: (code) => {
        setState("idle");
        setError(
          code === "not-allowed" || code === "service-not-allowed"
            ? "Мікрофон заборонено — дозвольте його в налаштуваннях"
            : code === "no-speech"
              ? "Не почув — спробуйте ще раз"
              : "Не вдалося розпізнати"
        );
      },
    });
    if (!instance) {
      setError("Голос тут не підтримується");
      return;
    }
    browserRecognition.current = instance;
    setState("listening");
    instance.start();
  }, [onText]);

  const send = useCallback(
    async (blob: Blob, mime: string) => {
      setState("sending");
      const form = new FormData();
      const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
      form.append("audio", blob, `voice.${ext}`);
      form.append("name", `voice.${ext}`);

      try {
        const res = await fetch("/api/sales/assistant/voice", { method: "POST", body: form });
        if (res.status === 503 && canBrowser) {
          // Сервер розпізнавання не заведено — далі працюємо браузером.
          serverOff.current = true;
          setState("idle");
          startBrowser();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok || !data.text) {
          setError(data.error ?? "Не вдалося розпізнати");
          setState("idle");
          return;
        }
        onText(data.text);
      } catch {
        setError("Немає звʼязку — спробуйте ще раз");
      } finally {
        setState((s) => (s === "sending" ? "idle" : s));
      }
    },
    [canBrowser, onText, startBrowser]
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const instance = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];

      instance.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      instance.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = instance.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        recorder.current = null;
        if (blob.size < 1200) {
          // Коротше за клацання — людина торкнулася кнопки випадково.
          setState("idle");
          return;
        }
        void send(blob, type);
      };

      recorder.current = instance;
      setState("listening");
      instance.start();

      /**
       * Межа хвилини.
       *
       * Кнопку легко лишити ввімкненою в кишені, а хвилина дороги — це
       * мегабайти шуму, за які ще й платимо. Питання торгового не буває
       * довшим за півхвилини.
       */
      setTimeout(() => {
        if (recorder.current === instance && instance.state === "recording") instance.stop();
      }, 60_000);
    } catch (e) {
      setState("idle");

      /**
       * Кажемо, ЩО САМЕ сталося, а не «перевірте дозвіл».
       *
       * У цьому `try` лежать два різні кроки — запит мікрофона й створення
       * записувача, — і обидва списувалися на дозвіл. 07.09 власник оновив
       * застосунок, побачив «перевірте дозвіл», перевірив (дозвіл був) і
       * лишився без жодної підказки, що робити далі. Ім'я помилки розрізняє
       * випадки: NotAllowedError — справді заборона, NotFoundError — немає
       * мікрофона, NotSupportedError — WebView не вміє цей формат.
       */
      const name = e instanceof Error ? e.name : "";
      const inApp = typeof window !== "undefined" && !!window.BudvikApp;

      if (name === "NotAllowedError" || name === "SecurityError") {
        /*
          У застосунку просимо дозвіл самі: системний діалог із WebView
          з'являється не завжди, а другий дотик уже спрацює.
        */
        if (inApp && window.BudvikApp?.requestMic) {
          window.BudvikApp.requestMic();
          setError("Дозвольте мікрофон і натисніть ще раз");
        } else {
          setError("Мікрофон заборонено — дозвольте його в налаштуваннях");
        }
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("Мікрофон не знайдено");
      } else {
        setError(`Мікрофон не запустився${name ? `: ${name}` : ""}`);
      }
    }
  }, [send]);

  const toggle = useCallback(() => {
    setError(null);

    if (state === "listening") {
      if (recorder.current?.state === "recording") recorder.current.stop();
      else browserRecognition.current?.stop();
      return;
    }
    if (state === "sending") return;

    if (canRecord && !serverOff.current) void startRecording();
    else if (canBrowser) startBrowser();
    else setError("Голос тут не підтримується");
  }, [canBrowser, canRecord, startBrowser, startRecording, state]);

  return { state, error, supported, toggle };
}
