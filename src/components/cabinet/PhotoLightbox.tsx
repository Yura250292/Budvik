"use client";

/**
 * Перегляд фото на весь екран із гортанням.
 *
 * У картці клієнта фото відкривається просто посиланням — там знімок один,
 * і системний переглядач дає зум та «зберегти». Тут інакше: у повідомленні
 * до чотирьох фото, і посилання випхало б людину з чату по одному разу на
 * кожне, а в WebView застосунку нова вкладка нікуди не веде.
 */

import { useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export function PhotoLightbox({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: Array<{ id: string; url: string }>;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const count = photos.length;
  const go = useCallback(
    (step: number) => {
      if (count > 1) onIndex((index + step + count) % count);
    },
    [count, index, onIndex]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  const photo = photos[index];
  if (!photo) return null;

  return (
    <div className="fixed inset-0 z-[2100] flex flex-col bg-black/95" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm text-white/70">{count > 1 ? `${index + 1} з ${count}` : ""}</span>
        <button type="button" onClick={onClose} aria-label="Закрити" className="flex h-11 w-11 items-center justify-center text-white">
          <X size={22} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt="Фото з повідомлення" className="max-h-full max-w-full object-contain" />
      </div>

      {count > 1 && (
        <div
          className="flex items-center justify-center gap-6 py-4"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => go(-1)} aria-label="Попереднє" className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white">
            <ChevronLeft size={24} />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Наступне" className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white">
            <ChevronRight size={24} />
          </button>
        </div>
      )}
    </div>
  );
}
