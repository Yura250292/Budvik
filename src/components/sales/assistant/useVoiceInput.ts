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

/**
 * Відкрити мікрофон, з однією повторною спробою на «зайнято».
 *
 * Система віддає пристрій не миттєво: після того, як попередній потік
 * зупинено, наступний запит ще частку секунди може отримати NotReadableError.
 * Одна пауза перетворює «мікрофон зайнятий» на робочу кнопку; якщо його
 * справді тримає хтось інший, друга спроба провалиться так само, і людина
 * побачить чесний текст.
 */
async function openMic(): Promise<MediaStream> {
  const busy = (e: unknown) => {
    const name = e instanceof Error ? e.name : "";
    return name === "NotReadableError" || name === "AbortError";
  };

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (first) {
    if (!busy(first)) throw first;

    // Пристрій віддається не миттєво: після зупинки попереднього потоку
    // наступний запит ще частку секунди отримує «зайнято».
    await new Promise((r) => setTimeout(r, 400));
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (second) {
      if (!busy(second)) throw second;

      /**
       * Остання спроба — без обробки звуку.
       *
       * `{audio:true}` у Chromium означає ще й приглушення луни, шумодав і
       * автопідсилення, а це окремий шлях усередині Android: він уміє
       * відмовляти сам по собі, і тоді сторінка бачить те саме «зайнято»,
       * хоча мікрофон вільний. Без обробки якість трохи гірша, але питання
       * помічникові важливіше за ідеальний звук.
       */
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    }
  }
}

/**
 * Що система думає про мікрофон, коли ми всередині застосунку.
 *
 * Браузер про це не знає нічого: він бачить лише свій дозвіл сторінці, а
 * дозвіл САМОМУ застосунку лежить рівнем нижче. Тому питаємо застосунок.
 * Поза застосунком і в старих збірках — "unknown", і тоді нічого не
 * стверджуємо.
 */
function appMicPermission(): "granted" | "denied" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  try {
    return window.BudvikApp?.micPermission?.() ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Що сказати людині, коли мікрофон не відкрився.
 *
 * Кажемо, ЩО САМЕ сталося, а не «перевірте дозвіл». 07.09 власник оновив
 * застосунок, побачив «перевірте дозвіл», перевірив (дозвіл був) і лишився
 * без жодної підказки, що робити далі. Ім'я помилки розрізняє випадки, і
 * кожне має свою дію:
 *
 * - NotAllowedError / SecurityError — заборона на рівні сторінки;
 * - NotReadableError / AbortError — сторінці дозволили, а пристрій не
 *   відкрився. Тут ховаються ДВА різні стани, і браузер їх не розрізняє:
 *   дозволу немає в самого застосунку, або мікрофон справді хтось тримає.
 *   Розрізнити може лише застосунок, тому питаємо його;
 * - NotFoundError / OverconstrainedError — мікрофона немає.
 *
 * Головна помилка попередньої спроби була саме тут: NotReadableError
 * беззастережно списувався на «зайнятий іншим застосунком», і людина читала
 * звинувачення на адресу програми, якої не існувало.
 */
function micErrorText(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  const bridge = typeof window !== "undefined" ? window.BudvikApp : undefined;
  const appPermission = appMicPermission();

  /* Застосунку мікрофон не дали — і саме це, а не «зайнято», треба лікувати. */
  if (appPermission === "denied") {
    bridge?.requestMic?.();
    return "Планшет не дав застосунку мікрофон. Дозвольте у вікні, що з'явиться, і натисніть ще раз";
  }

  if (name === "NotAllowedError" || name === "SecurityError") {
    if (bridge?.requestMic) {
      bridge.requestMic();
      return "Дозвольте мікрофон і натисніть ще раз";
    }
    return "Мікрофон заборонено — дозвольте його в налаштуваннях";
  }

  if (name === "NotReadableError" || name === "AbortError") {
    /*
      Дозвіл є, пристрій не відкрився. Всередині застосунку найчастіша
      причина — не «інший застосунок», а те, що мікрофон тримає щось у
      самій системі й дозвіл треба перевидати руками. Тому ведемо в
      налаштування, а не звинувачуємо неіснуючу програму.
    */
    if (bridge) {
      /*
        Дозвіл у застосунку значиться виданим, а пристрій не відкрився.
        Перевидання дозволу — єдине, що тут узагалі можна натиснути, тож
        просимо його: якщо система насправді його не має, з'явиться діалог;
        якщо заборонено «назавжди», застосунок сам відкриє налаштування.
      */
      bridge.requestMic?.();
      return "Планшет не віддає мікрофон, хоча дозвіл значиться виданим. Перевидайте його у вікні, що з'явиться, і натисніть ще раз";
    }
    return "Мікрофон не відкрився — його тримає інша вкладка або програма";
  }

  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Мікрофон не знайдено";
  }
  return `Мікрофон не запустився${name ? `: ${name}` : ""}`;
}

export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  /**
   * Живий потік мікрофона — окремо від записувача.
   *
   * Записувач з'являється ПІСЛЯ потоку, і саме між цими двома рядками ховалася
   * поламка: `new MediaRecorder(stream)` кидає виняток на форматі, якого
   * WebView не вміє, — а потік лишався відкритим і тримав мікрофон. Далі кожна
   * наступна спроба отримувала NotReadableError («пристрій зайнятий»), бо
   * зайнятий він був нами ж. Відпустити було нічим: посилання на потік не
   * зберігав ніхто.
   */
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const browserRecognition = useRef<ReturnType<typeof createRecognition>>(null);
  const serverOff = useRef(false);

  const canRecord = recorderSupported();
  const canBrowser = voiceInputSupported();
  const supported = canRecord || canBrowser;

  /** Відпустити мікрофон. Викликається і на успіху, і на будь-якому провалі. */
  const releaseMic = useCallback(() => {
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  const stopEverything = useCallback(() => {
    releaseMic();
    browserRecognition.current?.abort();
    browserRecognition.current = null;
  }, [releaseMic]);

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
    /**
     * Перед новою спробою відпускаємо стару.
     *
     * Мікрофон на Android віддається одному власнику: доки наш попередній
     * потік живий, `getUserMedia` відповідає NotReadableError і кнопка
     * виглядає зламаною назавжди — до перезавантаження сторінки.
     */
    releaseMic();

    let mic: MediaStream;
    try {
      mic = await openMic();
    } catch (e) {
      setState("idle");
      setError(micErrorText(e));
      return;
    }
    stream.current = mic;

    try {
      const mime = pickMime();
      const instance = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined);
      chunks.current = [];

      instance.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      instance.onstop = () => {
        releaseMic();
        const type = instance.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type });
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
      /**
       * Записувач не створився — мікрофон ВІДПУСКАЄМО.
       *
       * Саме цього рядка тут і бракувало. Без нього провал на форматі
       * залишав потік відкритим, і всі наступні натискання отримували
       * NotReadableError — тобто одна помилка формату перетворювалася на
       * «мікрофон не працює взагалі», яку не лікувало ні перевидання
       * дозволу, ні оновлення застосунку.
       */
      releaseMic();
      setState("idle");
      const name = e instanceof Error ? e.name : "";
      setError(
        name === "NotSupportedError"
          ? "Цей планшет не вміє записувати звук у потрібному форматі"
          : `Запис не почався${name ? `: ${name}` : ""}`
      );
    }
  }, [releaseMic, send]);

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
