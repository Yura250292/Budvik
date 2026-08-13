"use client";

import { useState, useRef, useCallback } from "react";

/**
 * Свайп рядка вправо — додати товар у кошик.
 *
 * Торговий стоїть перед клієнтом із планшетом і набирає замовлення прямо
 * з каталогу. Кнопка «+» тут програє жесту: у неї треба цілитись, а
 * свайп проходить усією шириною рядка й не вимагає точності — рука
 * зайнята, планшет тримають однією.
 *
 * Поріг спрацювання — 40% ширини рядка. Менше означало б випадкові
 * додавання під час гортання списку; більше — незручний розмах на
 * широкому планшеті.
 */
const TRIGGER_RATIO = 0.4;
const MAX_PULL = 140;

export default function SwipeToCart({
  children,
  onAdd,
  disabled = false,
}: {
  children: React.ReactNode;
  onAdd: () => void;
  /** Немає ціни — додавати нічого: сума замовлення була б неправдивою. */
  disabled?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [flash, setFlash] = useState(false);
  // Ширину тримаємо в стані, а не читаємо з ref під час рендера: інакше
  // підкладка «Відпустіть — у кошик» рахувала б поріг зі застарілого
  // значення після повороту планшета.
  const [width, setWidth] = useState(320);
  const rowRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number; locked: boolean | null } | null>(null);

  const onStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, locked: null };
    if (rowRef.current) setWidth(rowRef.current.offsetWidth);
  }, [disabled]);

  const onMove = useCallback((e: React.TouchEvent) => {
    if (!touch.current || disabled) return;
    const t = e.touches[0];
    const dX = t.clientX - touch.current.x;
    const dY = Math.abs(t.clientY - touch.current.y);

    // Напрямок фіксуємо один раз: без цього вертикальне гортання списку
    // тягло б рядки вбік на кожному русі пальця.
    if (touch.current.locked === null && (Math.abs(dX) > 8 || dY > 8)) {
      touch.current.locked = Math.abs(dX) > dY;
    }
    if (!touch.current.locked) return;

    // Тягнемо лише вправо; опір після максимуму, щоб жест мав край.
    const clamped = dX <= 0 ? 0 : Math.min(dX, MAX_PULL + (dX - MAX_PULL) * 0.2);
    setDx(clamped);
  }, [disabled]);

  const onEnd = useCallback(() => {
    if (!touch.current) return;
    const fired = dx >= width * TRIGGER_RATIO;
    touch.current = null;

    if (fired) {
      onAdd();
      setFlash(true);
      setTimeout(() => setFlash(false), 550);
    }
    setDx(0);
  }, [dx, onAdd, width]);

  const ready = dx >= width * TRIGGER_RATIO;

  return (
    <div ref={rowRef} className="relative overflow-hidden">
      {/* Підкладка під рядком: видно, куди тягнеш і коли спрацює */}
      <div
        className={`absolute inset-0 flex items-center gap-2 px-4 transition-colors ${
          ready ? "bg-[#15803D]" : "bg-[#15803D]/35"
        }`}
        aria-hidden
      >
        <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3A1 1 0 005.4 17H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        <span className="text-sm font-semibold text-white">
          {ready ? "Відпустіть — у кошик" : "У кошик"}
        </span>
      </div>

      <div
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dx === 0 ? "transform 0.22s cubic-bezier(0.2,0.8,0.2,1)" : "none",
        }}
        className={`relative bg-white ${flash ? "animate-[cartflash_0.55s_ease-out]" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
