"use client";

/**
 * Камера прямо в сторінці.
 *
 * `<input capture="environment">` — лише прохання, і контейнер має право
 * його не почути: у WebView вибір файлу цілком віддано нативному коду, і
 * той відкриває документи, а не камеру. Саме тому «зняти фото» на планшеті
 * перетворювалось на «вибрати з галереї».
 *
 * getUserMedia від контейнера не залежить: кадр беремо самі з потоку.
 * Мовчазного відкату на галерею тут немає навмисно — він ховає саме те, що
 * треба полагодити (дозвіл, зайняту камеру, контейнер без доступу), а для
 * людини виглядає як зламана кнопка.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { compress, type Shot } from "./compress";

export type Camera = {
  on: boolean;
  ready: boolean;
  error: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  open: () => Promise<void>;
  close: () => void;
  /** Кадр із живого потоку, уже стиснений. Камера гасне одразу після знімка. */
  shoot: () => Promise<Shot | null>;
  onLoaded: () => void;
  clearError: () => void;
};

export function useInPageCamera(): Camera {
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const close = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
    setReady(false);
  }, []);

  const open = useCallback(async () => {
    setError(null);
    if (!window.isSecureContext) {
      setError("Камера доступна лише через захищене з'єднання (https).");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Цей застосунок не дає сторінці доступ до камери.");
      return;
    }

    /**
     * Дозвіл питає сам getUserMedia — окремого «запитати» в браузера немає.
     * Стан дозволу дивимось лише ПІСЛЯ відмови: перевірка перед викликом
     * уміє віддати «denied» там, де насправді зʼявилося б вікно запиту, і
     * тоді вона б назавжди відрізала єдиний шлях дозволити камеру.
     */
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        // Тилова камера: знімають товар і накладну, а не себе. `ideal`, а не
        // `exact` — на планшеті без тилової камери exact просто впав би.
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      setOn(true);
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      let blocked = false;
      try {
        const status = await navigator.permissions.query({ name: "camera" } as unknown as PermissionDescriptor);
        blocked = status.state === "denied";
      } catch {
        // Браузер не вміє — лишаємо загальніший текст.
      }
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? blocked
            ? "Камеру для цього сайту заблоковано, і браузер більше не питатиме. Меню ⋮ → «Інформація про сайт» → Дозволи → Камера → Дозволити."
            : "Доступ до камери не надано. Натисніть ще раз і оберіть «Дозволити»."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "Камери не знайдено."
            : name === "NotReadableError"
              ? "Камеру зайняв інший застосунок. Закрийте його й спробуйте ще раз."
              : `Не вдалося увімкнути камеру${name ? ` (${name})` : ""}.`
      );
    }
  }, []);

  /** Потік чіпляємо після того, як <video> опинився в дереві. */
  useEffect(() => {
    if (!on) return;
    const v = videoRef.current;
    if (!v || !streamRef.current) return;
    v.srcObject = streamRef.current;
    v.play().catch(() => {});
  }, [on]);

  /**
   * Камеру гасимо й на розмонтуванні. Без цього вона лишається зайнятою
   * після закриття екрана — на планшеті це видно по індикатору, і людина
   * справедливо вирішує, що застосунок за нею підглядає.
   */
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    },
    []
  );

  const shoot = useCallback(async (): Promise<Shot | null> => {
    const v = videoRef.current;
    if (!v?.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) return null;
    // Гасимо камеру одразу після кадру: далі вона не потрібна, а тримати її
    // ввімкненою, поки людина пише текст, — це і батарея, і індикатор.
    close();
    // Той самий шлях стиснення, що й для файлу з галереї.
    return compress(new File([blob], "photo.jpg", { type: "image/jpeg" }));
  }, [close]);

  return {
    on,
    ready,
    error,
    videoRef,
    open,
    close,
    shoot,
    onLoaded: () => setReady(true),
    clearError: () => setError(null),
  };
}
