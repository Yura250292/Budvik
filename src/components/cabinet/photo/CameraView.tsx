"use client";

/**
 * Видошукач на весь екран.
 *
 * Окремим шаром поверх усього, а не всередині форми: форма закривається
 * дотиком у підкладку, і тап повз кнопку спуску гасив би її разом із
 * набраним текстом.
 */

import type { RefObject } from "react";

/**
 * Пропси окремо, а не весь обʼєкт хука: правило react-hooks/refs вважає
 * обʼєкт, у якому лежить ref, самим рефом — і забороняє читати його поля в
 * рендері. Реф сюди приходить лише щоб причепитися до <video>.
 */
export function CameraView({
  on,
  ready,
  videoRef,
  onLoaded,
  onClose,
  onShoot,
  busy = false,
}: {
  on: boolean;
  ready: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onLoaded: () => void;
  onClose: () => void;
  /** Що робити з кадром. Знімок робить камера, а куди він піде — знає екран. */
  onShoot: () => void;
  busy?: boolean;
}) {
  if (!on) return null;

  return (
    <div className="fixed inset-0 z-[2100] flex flex-col bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onLoadedMetadata={onLoaded}
        className="min-h-0 flex-1 object-contain"
      />
      <div
        className="flex items-center justify-between gap-4 px-6 py-5"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <button type="button" onClick={onClose} className="text-sm text-white/70">
          Скасувати
        </button>
        {/* Кругла кнопка спуску: у неї цілять пальцем у робочій рукавиці,
            тож 72 px, а не звичайні 44. */}
        <button
          type="button"
          onClick={onShoot}
          disabled={!ready || busy}
          aria-label="Зняти"
          className="rounded-full disabled:opacity-40"
          style={{
            width: "72px",
            height: "72px",
            background: "#fff",
            border: "4px solid rgba(255,255,255,0.35)",
            backgroundClip: "padding-box",
          }}
        />
        {/* Порожній блок тієї ж ширини, що «Скасувати»: без нього спуск
            з'їжджає з центру екрана. */}
        <span aria-hidden className="text-sm text-transparent">
          Скасувати
        </span>
      </div>
    </div>
  );
}
