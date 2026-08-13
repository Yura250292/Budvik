"use client";

/**
 * Запис треку з планшета, який стоїть у машині.
 *
 * Умова, на якій усе тримається: вкладка на передньому плані. Браузер не
 * дає геолокацію фоновій вкладці — саме тому трек торгових досі збирав
 * Telegram-бот. Планшет у тримачі це обмеження знімає, тож тут вистачає
 * watchPosition, а Wake Lock не дає екрану згаснути й відправити вкладку
 * у фон.
 *
 * Три речі, без яких трек рветься в реальній їзді:
 *
 *   1. Буфер у localStorage. Зв'язок у селі зникає на кілька хвилин;
 *      точки чекають і доїжджають разом. Переживає і перезавантаження
 *      сторінки, і випадкове закриття вкладки.
 *   2. Проріджування на клієнті. GPS сипле точку щосекунди, але 300
 *      точок стоянки біля магазину нічого не додають — пишемо, коли
 *      минуло 15 с АБО зсунулися на 30 м.
 *   3. Перезапуск на visibilitychange. Водій відкрив Google Maps, вкладка
 *      пішла у фон, watchPosition завмер. Коли повернувся — стартуємо
 *      наново і флашимо буфер.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const BUFFER_KEY = "budvik.track.buffer.v1";

/** Як часто відправляємо накопичене, мс. */
const FLUSH_INTERVAL_MS = 25_000;
/** Або раніше, якщо назбиралося стільки точок. */
const FLUSH_AT_POINTS = 20;
/** Мінімальний інтервал між записаними точками, мс. */
const MIN_INTERVAL_MS = 15_000;
/** Або пишемо раніше, якщо зсунулися на стільки метрів. */
const MIN_MOVE_M = 30;
/** Скільки точок тримаємо в буфері максимум — далі викидаємо найстаріші. */
const BUFFER_CAP = 2_000;

export type TrackStatus =
  | "idle" // ще не стартував
  | "live" // точки йдуть і відправляються
  | "buffering" // точки йдуть, але сервер недоступний
  | "denied" // користувач не дав геолокацію
  | "unsupported"; // браузер без geolocation

export type BufferedPoint = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  recordedAt: string;
};

function readBuffer(): BufferedPoint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BUFFER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBuffer(points: BufferedPoint[]) {
  try {
    // Обрізаємо найстаріші: якщо планшет пролежав офлайн пів дня, краще
    // втратити ранок, ніж упертися в квоту localStorage і втратити все.
    const trimmed = points.length > BUFFER_CAP ? points.slice(-BUFFER_CAP) : points;
    window.localStorage.setItem(BUFFER_KEY, JSON.stringify(trimmed));
  } catch {
    // Квота вичерпана — краще працювати без буфера, ніж падати.
  }
}

const EARTH_R = 6_371_000;
function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Рух «зараз» — для карти, а не для бази.
 *
 * Точки в базу пишемо проріджено (раз на 15 с), але карта має їхати
 * плавно, тож ці дані оновлюються на КОЖЕН відлік GPS.
 *
 * heading браузер дає лише коли машина справді їде; на стоянці там
 * NaN або null. Тому курс тримаємо останній відомий: інакше карта
 * смикалася б у нуль щоразу, як водій пригальмував на світлофорі.
 */
export type Motion = {
  lat: number;
  lng: number;
  /** Швидкість, км/год. null, якщо GPS її не дає */
  speedKmh: number | null;
  /** Курс, градуси від півночі. Останній відомий, не миттєвий */
  headingDeg: number | null;
  /** Радіус похибки GPS, м — «конус» точності навколо стрілки */
  accuracyM: number | null;
};

export type UseTrackRecorder = {
  status: TrackStatus;
  /** Скільки точок чекає відправки */
  pending: number;
  /** Пробіг за сьогодні за даними сервера, км */
  distanceKm: number;
  /** Остання позиція — щоб намалювати «ви тут» */
  position: { lat: number; lng: number } | null;
  /** Позиція + швидкість + курс на кожен відлік GPS — для анімації карти */
  motion: Motion | null;
  /** Свіжі точки цієї сесії для домальовування polyline */
  trail: Array<[number, number]>;
  start: () => void;
  stop: () => void;
};

/** Нижче цієї швидкості курс від GPS — шум, тримаємо попередній. */
const HEADING_MIN_KMH = 3;

export function useTrackRecorder(options: { enabled: boolean }): UseTrackRecorder {
  const { enabled } = options;

  const [status, setStatus] = useState<TrackStatus>("idle");
  const [pending, setPending] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [motion, setMotion] = useState<Motion | null>(null);
  const [trail, setTrail] = useState<Array<[number, number]>>([]);

  const watchIdRef = useRef<number | null>(null);
  const bufferRef = useRef<BufferedPoint[]>([]);
  const lastWrittenRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const flushingRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    const batch = bufferRef.current;
    if (batch.length === 0) return;

    flushingRef.current = true;
    // Копію відправляємо, оригінал не чистимо до підтвердження: якщо
    // запит впаде, точки лишаються в буфері й поїдуть наступного разу.
    const sending = batch.slice();
    try {
      const res = await fetch("/api/track/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: sending }),
        keepalive: true,
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();

      bufferRef.current = bufferRef.current.slice(sending.length);
      writeBuffer(bufferRef.current);
      setPending(bufferRef.current.length);
      if (typeof json?.sessionDistanceKm === "number") setDistanceKm(json.sessionDistanceKm);
      setStatus("live");
    } catch {
      setStatus("buffering");
    } finally {
      flushingRef.current = false;
    }
  }, []);

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
    setPosition({ lat, lng });

    const speedKmh =
      typeof speed === "number" && speed >= 0 && !Number.isNaN(speed) ? speed * 3.6 : null;
    const freshHeading =
      typeof heading === "number" && !Number.isNaN(heading) ? heading : null;

    // Курс лишаємо попередній, поки машина повзе: на швидкості нижче
    // 3 км/год GPS крутить стрілку як завгодно, і карта б смикалась.
    const keepHeading = speedKmh != null && speedKmh < HEADING_MIN_KMH;
    setMotion((prev) => ({
      lat,
      lng,
      speedKmh,
      headingDeg:
        (keepHeading ? prev?.headingDeg ?? freshHeading : freshHeading) ??
        prev?.headingDeg ??
        null,
      accuracyM: typeof accuracy === "number" ? accuracy : null,
    }));

    const now = pos.timestamp || Date.now();
    const last = lastWrittenRef.current;
    // Проріджування: або минув інтервал, або реально зрушили з місця.
    if (last) {
      const movedEnough = metersBetween(last, { lat, lng }) >= MIN_MOVE_M;
      const waitedEnough = now - last.at >= MIN_INTERVAL_MS;
      if (!movedEnough && !waitedEnough) return;
    }

    const point: BufferedPoint = {
      lat,
      lng,
      accuracyM: typeof accuracy === "number" ? Math.round(accuracy) : null,
      speedKmh: speedKmh != null ? Math.round(speedKmh) : null,
      headingDeg: freshHeading != null ? Math.round(freshHeading) : null,
      recordedAt: new Date(now).toISOString(),
    };

    bufferRef.current = [...bufferRef.current, point];
    writeBuffer(bufferRef.current);
    lastWrittenRef.current = { lat, lng, at: now };
    setPending(bufferRef.current.length);
    setTrail((prev) => [...prev, [lat, lng]]);

    if (bufferRef.current.length >= FLUSH_AT_POINTS) void flush();
  }, [flush]);

  const requestWakeLock = useCallback(async () => {
    try {
      const anyNav = navigator as Navigator & { wakeLock?: WakeLock };
      if (!anyNav.wakeLock) return;
      wakeLockRef.current = await anyNav.wakeLock.request("screen");
    } catch {
      // Не критично: екран згасне, водій його розбудить.
    }
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    if (watchIdRef.current !== null) return;

    bufferRef.current = readBuffer();
    setPending(bufferRef.current.length);

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setStatus("denied");
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 }
    );
    setStatus("live");
    void requestWakeLock();
    void flush();
  }, [handlePosition, requestWakeLock, flush]);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Періодичний флаш: точки можуть капати повільно, і без таймера пачка
  // з трьох точок висіла б у буфері до наступного руху.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, flush]);

  // Повернення з фону: watchPosition міг завмерти, поки водій дивився в
  // Google Maps, а Wake Lock система знімає сама.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      start();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, start]);

  // Остання спроба віддати буфер, коли вкладку закривають.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [enabled, flush]);

  return { status, pending, distanceKm, position, motion, trail, start, stop };
}
