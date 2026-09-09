"use client";

/**
 * Фото в повідомленні: одне на всю ширину, кілька — сіткою.
 *
 * Місце під знімок резервуємо з його пропорцій (aspect-ratio), інакше
 * стрічка стрибає під пальцем, поки фото довантажуються — а це саме та
 * мить, коли людина цілиться в кнопку.
 */

import { useState } from "react";
import { PhotoLightbox } from "@/components/cabinet/PhotoLightbox";
import type { ChatPhoto } from "./api";

export function PhotoGrid({ photos }: { photos: ChatPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;

  const single = photos.length === 1;

  return (
    <>
      <div className={`mt-2 ${single ? "" : "grid grid-cols-2 gap-1.5"}`}>
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            className="block w-full overflow-hidden rounded-xl bg-cab-bg"
            style={
              single && p.width > 0 && p.height > 0
                ? { aspectRatio: `${p.width} / ${p.height}`, maxHeight: "60vh" }
                : { aspectRatio: "1 / 1" }
            }
            aria-label="Відкрити фото"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="Фото з повідомлення" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open !== null && <PhotoLightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}
