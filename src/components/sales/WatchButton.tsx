"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";

/**
 * Дзвіночок «повідомити, коли приїде» біля відсутньої позиції каталогу.
 *
 * Сторінка каталогу кешується (revalidate 60), тож чиї запити — знає лише
 * браузер: перелік підтягується один раз на сторінку спільним промісом, а
 * не окремим запитом на кожен із сорока рядків.
 */

let watchedPromise: Promise<Set<string>> | null = null;

function loadWatched(): Promise<Set<string>> {
  if (!watchedPromise) {
    watchedPromise = fetch("/api/sales/watches")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: { productId: string; arrivedAt: string | null }[] }) =>
        new Set((d.items ?? []).filter((i) => !i.arrivedAt).map((i) => i.productId))
      )
      .catch(() => new Set<string>());
  }
  return watchedPromise;
}

export function WatchButton({ productId }: { productId: string }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadWatched().then((set) => {
      if (alive) setOn(set.has(productId));
    });
    return () => {
      alive = false;
    };
  }, [productId]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      if (on) {
        await fetch(`/api/sales/watches?productId=${encodeURIComponent(productId)}`, { method: "DELETE" });
        (await loadWatched()).delete(productId);
        setOn(false);
      } else {
        const res = await fetch("/api/sales/watches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        });
        const data = (await res.json().catch(() => ({}))) as { watching?: boolean; inStock?: number; error?: string };
        if (!res.ok) throw new Error(data.error || String(res.status));
        if (data.watching) {
          (await loadWatched()).add(productId);
          setOn(true);
          setNote("Повідомимо, коли приїде");
        } else {
          setNote(`Вже є: ${data.inStock} шт`);
        }
      }
    } catch {
      setNote("Не вдалося, спробуйте ще");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          // Рядок сидить у SwipeToCart і посиланні — тап по дзвіночку не має
          // ні додавати в кошик, ні відкривати товар.
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={busy}
        aria-pressed={on}
        aria-label={on ? "Не повідомляти про приїзд" : "Повідомити, коли приїде"}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
          on ? "border-[#0A0A0A] bg-[#0A0A0A] text-[#FFD600]" : "border-g200 bg-white text-g500"
        } disabled:opacity-50`}
      >
        {on ? <BellRing size={12} /> : <Bell size={12} />}
        {on ? "Чекаю" : "Коли буде"}
      </button>
      {note && <span className="text-[11px] text-g500">{note}</span>}
    </span>
  );
}
