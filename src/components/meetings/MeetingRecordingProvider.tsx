"use client";

/**
 * Запис наради, який переживає перехід між сторінками адмінки.
 *
 * Провайдер стоїть в AdminShell над вмістом вкладок: керівник почав запис на
 * /admin/meetings/new, пішов глянути борги — запис іде далі, а внизу висить
 * пігулка з таймером (MeetingMiniRecorder).
 *
 * Перенесено з Metrum (contexts/MeetingRecordingContext.tsx) з правками під
 * Budvik:
 * - мікрофон відкриває спільний openMic — з повтором на «зайнято» й людськими
 *   текстами для WebView робочої збірки;
 * - на телефоні 64 кбіт/с замість 96: розпізнавачу вистачає, а година запису
 *   в пам'яті вкладки легша на третину;
 * - fix-webm-duration лише до 40 МБ: він копіює весь запис у пам'ять, і на
 *   телефоні довга нарада вбила б вкладку;
 * - мікрофон замовк на 10 с (згас екран, дзвінок) — запис на паузі й чесний
 *   текст, а не година тиші у файлі.
 *
 * На телефоні це все одно запасний шлях: коли екран гасне, система забирає
 * мікрофон у сторінки. Головний шлях з телефона — диктофон і завантаження файлу.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { micErrorText, openMic, recorderSupported } from "@/components/sales/assistant/mic";

export type RecState = "idle" | "recording" | "paused" | "stopped";

export type RecordedAudio = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Коли натиснули «Почати» — стане датою наради. */
  startedAt: number;
  fileName: string;
};

export const MAX_RECORD_MS = 90 * 60 * 1000;
const DESKTOP_BPS = 96_000;
const MOBILE_BPS = 64_000;
const FIX_DURATION_MAX_BYTES = 40 * 1024 * 1024;
const MUTED_PAUSE_MS = 10_000;

type ContextValue = {
  supported: boolean;
  state: RecState;
  elapsedMs: number;
  error: string | null;
  recorded: RecordedAudio | null;
  wakeLockActive: boolean;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
};

const NOOP = () => {};

const RecordingContext = createContext<ContextValue>({
  supported: false,
  state: "idle",
  elapsedMs: 0,
  error: null,
  recorded: null,
  wakeLockActive: false,
  start: async () => {},
  pause: NOOP,
  resume: NOOP,
  stop: NOOP,
  reset: NOOP,
});

function fileNameFor(startedAt: number, mime: string): string {
  const d = new Date(startedAt);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  return `narada-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

export function MeetingRecordingProvider({ children }: { children: ReactNode }) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<RecState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<RecordedAudio | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const startedAtRef = useRef(0);
  /** Скільки записано до поточного відрізка (паузи не рахуються). */
  const accumulatedRef = useRef(0);
  const segmentStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const muteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  /** «Записати заново» посеред запису — зупинити без збереження. */
  const discardRef = useRef(false);

  useEffect(() => setSupported(recorderSupported()), []);

  const elapsedNow = useCallback(
    () => accumulatedRef.current + (segmentStartRef.current ? Date.now() - segmentStartRef.current : 0),
    []
  );

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    segmentStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const ms = elapsedNow();
      setElapsedMs(ms);
      if (ms >= MAX_RECORD_MS) {
        try {
          recorderRef.current?.stop();
        } catch {
          /* уже зупинено */
        }
      }
    }, 500);
  }, [elapsedNow, stopTimer]);

  const pauseClock = useCallback(() => {
    accumulatedRef.current = elapsedNow();
    segmentStartRef.current = 0;
    stopTimer();
    setElapsedMs(accumulatedRef.current);
  }, [elapsedNow, stopTimer]);

  const releaseMic = useCallback(() => {
    if (muteTimerRef.current) clearTimeout(muteTimerRef.current);
    muteTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeRef.current?.release();
    } catch {
      /* уже відпущено */
    }
    wakeRef.current = null;
    setWakeLockActive(false);
  }, []);

  const acquireWakeLock = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
      const sentinel = await navigator.wakeLock.request("screen");
      wakeRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener("release", () => {
        wakeRef.current = null;
        setWakeLockActive(false);
      });
    } catch {
      // Екран не тримається (енергозбереження, старий браузер) — запис однаково йде.
    }
  }, []);

  const finish = useCallback(async () => {
    pauseClock();
    const durationMs = accumulatedRef.current;
    const type = mimeRef.current;
    const raw = new Blob(chunksRef.current, { type });
    chunksRef.current = [];
    recorderRef.current = null;
    releaseMic();
    void releaseWakeLock();

    if (discardRef.current) {
      discardRef.current = false;
      setState("idle");
      setElapsedMs(0);
      return;
    }
    if (raw.size < 1024) {
      setState("idle");
      setError("Запис порожній — мікрофон нічого не передав");
      return;
    }

    // MediaRecorder не пише тривалість у WebM, і плеєр не вміє перемотувати.
    // Лагодимо лише помірні файли: бібліотека тримає весь запис у пам'яті.
    let blob = raw;
    const canFix =
      type.includes("webm") && raw.size <= FIX_DURATION_MAX_BYTES && durationMs >= 1000 && durationMs <= 6 * 3600_000;
    if (canFix) {
      try {
        const mod = (await import("fix-webm-duration")) as unknown as { default?: unknown };
        const fix = (mod.default ?? mod) as (b: Blob, d: number, o?: { logger?: false }) => Promise<Blob>;
        blob = await fix(raw, durationMs, { logger: false });
      } catch (e) {
        console.warn("[meetings] fix-webm-duration не вдався — лишаю сирий запис:", e);
        blob = raw;
      }
    }

    setRecorded({
      blob,
      mimeType: type,
      durationMs,
      startedAt: startedAtRef.current,
      fileName: fileNameFor(startedAtRef.current, type),
    });
    setState("stopped");
  }, [pauseClock, releaseMic, releaseWakeLock]);

  const start = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;
    setError(null);
    setRecorded(null);
    setElapsedMs(0);
    accumulatedRef.current = 0;
    segmentStartRef.current = 0;
    chunksRef.current = [];
    discardRef.current = false;
    releaseMic();

    let stream: MediaStream;
    try {
      stream = await openMic({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    } catch (e) {
      setError(micErrorText(e));
      return;
    }
    streamRef.current = stream;

    const ua = navigator.userAgent;
    // Safari погано грає webm — пишемо в mp4 (AAC), щоб запис відтворювався там само.
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const mobile = /Android|iPhone|iPad|iPod/i.test(ua);
    const candidates = isSafari
      ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported?.(m));

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: mobile ? MOBILE_BPS : DESKTOP_BPS,
      });
    } catch (e) {
      // Записувач не створився — мікрофон ВІДПУСКАЄМО, інакше наступна спроба
      // отримає «зайнято» від нас самих (урок useVoiceInput).
      releaseMic();
      const name = e instanceof Error ? e.name : "";
      setError(
        name === "NotSupportedError"
          ? "Цей браузер не вміє записувати звук у потрібному форматі — завантажте файл із диктофона"
          : `Запис не почався${name ? `: ${name}` : ""}`
      );
      return;
    }

    mimeRef.current = recorder.mimeType || mime || "audio/webm";
    recorderRef.current = recorder;
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onstop = () => void finish();
    recorder.onerror = () => {
      setError("Запис перервався — збережено те, що встигло записатись");
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* уже зупинено */
      }
    };

    const track = stream.getAudioTracks()[0];
    if (track) {
      track.onended = () => {
        if (recorder.state === "inactive") return;
        setError("Мікрофон відключився — збережено те, що встигло записатись");
        try {
          recorder.stop();
        } catch {
          /* уже зупинено */
        }
      };
      track.onmute = () => {
        if (muteTimerRef.current) clearTimeout(muteTimerRef.current);
        muteTimerRef.current = setTimeout(() => {
          if (recorder.state !== "recording") return;
          recorder.pause();
          pauseClock();
          setState("paused");
          setError("Мікрофон замовк — запис на паузі. Якщо згасав екран чи був дзвінок, натисніть «Продовжити».");
        }, MUTED_PAUSE_MS);
      };
      track.onunmute = () => {
        if (muteTimerRef.current) clearTimeout(muteTimerRef.current);
        muteTimerRef.current = null;
      };
    }

    startedAtRef.current = Date.now();
    // Шматок кожні 3 с — при падінні вкладки губиться не весь запис.
    recorder.start(3000);
    startTimer();
    setState("recording");
    void acquireWakeLock();
  }, [acquireWakeLock, finish, pauseClock, releaseMic, startTimer]);

  const pause = useCallback(() => {
    const r = recorderRef.current;
    if (r?.state !== "recording") return;
    r.pause();
    pauseClock();
    setState("paused");
  }, [pauseClock]);

  const resume = useCallback(() => {
    const r = recorderRef.current;
    if (r?.state !== "paused") return;
    r.resume();
    setError(null);
    startTimer();
    setState("recording");
  }, [startTimer]);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && (r.state === "recording" || r.state === "paused")) r.stop();
  }, []);

  const reset = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      discardRef.current = true;
      r.stop();
      return;
    }
    setState("idle");
    setElapsedMs(0);
    setRecorded(null);
    setError(null);
    accumulatedRef.current = 0;
  }, []);

  // Система відпускає блокування екрана, коли вкладку сховали; повертаємо його.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && (state === "recording" || state === "paused") && !wakeRef.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [state, acquireWakeLock]);

  // Закрити вкладку посеред наради — втратити запис; питаємо.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state === "recording" || state === "paused") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state]);

  useEffect(
    () => () => {
      stopTimer();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [stopTimer]
  );

  const value = useMemo<ContextValue>(
    () => ({ supported, state, elapsedMs, error, recorded, wakeLockActive, start, pause, resume, stop, reset }),
    [supported, state, elapsedMs, error, recorded, wakeLockActive, start, pause, resume, stop, reset]
  );

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>;
}

export function useMeetingRecording(): ContextValue {
  return useContext(RecordingContext);
}
