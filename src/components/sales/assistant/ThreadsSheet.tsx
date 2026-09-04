"use client";

/**
 * Історія розмов — нижнім листом, а не окремим екраном.
 *
 * Окремий екран означав би зайвий крок «назад» щоразу, коли торговий
 * просто хотів почати нову розмову. Лист відкривається поверх діалогу й
 * закривається торканням фону.
 */

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { COPY } from "./copy";
import type { ThreadSummary } from "./api";

function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `сьогодні ${date.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return "вчора";
  return date.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
}

export default function ThreadsSheet({
  open,
  threads,
  currentId,
  onPick,
  onNew,
  onDelete,
  onClose,
}: {
  open: boolean;
  threads: ThreadSummary[];
  currentId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!open) return null;

  return (
    <>
      {/* Панель вкладок має z-50 — лист мусить бути вище, інакше він
          відкривається під нею. */}
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[70vh] flex-col rounded-t-2xl bg-white"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center justify-between border-b border-cab-line px-4 py-3">
          <span className="text-[15px] font-bold text-bk">{COPY.threads}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="flex h-11 w-11 items-center justify-center text-cab-t2"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          <button
            type="button"
            onClick={onNew}
            className="mb-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-bk px-3 text-[13px] font-semibold text-white"
          >
            <Plus size={16} />
            {COPY.newThread}
          </button>

          {threads.length === 0 ? (
            <p className="py-6 text-center text-sm text-cab-t3">{COPY.noThreads}</p>
          ) : (
            <ul className="flex flex-col">
              {threads.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 border-b border-[#F1F1EF] py-1 last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => onPick(t.id)}
                    className="min-w-0 flex-1 py-2 text-left"
                  >
                    <span
                      className={`block truncate text-[14px] ${
                        t.id === currentId ? "font-bold text-bk" : "font-medium text-bk"
                      }`}
                    >
                      {t.title ?? COPY.untitled}
                    </span>
                    <span className="block text-[11px] text-cab-t3">{when(t.lastMessageAt)}</span>
                  </button>

                  {confirming === t.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirming(null);
                        onDelete(t.id);
                      }}
                      className="shrink-0 px-2 py-2 text-[12px] font-bold text-bad-fg"
                    >
                      {COPY.deleteYes}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={COPY.deleteAsk}
                      onClick={() => setConfirming(t.id)}
                      className="flex h-11 w-9 shrink-0 items-center justify-center text-cab-t3"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
