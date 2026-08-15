"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Вибір торгових для таблиць КПІ.
 *
 * У списку ролі SALES живуть і давно неактивні акаунти — вони тягнуть за собою
 * рядки з нулями і ховають тих, хто реально продає. Прапорця «активний» у
 * користувача немає, тож відсіює руками керівник, а вибір лишається в
 * localStorage: інакше після кожного перезаходу довелося б клацати заново.
 */

export type RepOption = { id: string; name: string };

const EMPTY: string[] = [];

function readStored(storageKey: string): string[] {
  if (typeof window === "undefined") return EMPTY; // SSR-прохід: сервер про localStorage не знає
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : EMPTY;
  } catch {
    return EMPTY; // зіпсований запис — просто показуємо всіх
  }
}

/**
 * Обраний набір id. Порожня множина = «усі» — так новий торговий з'являється
 * в таблиці сам, а не зникає через збережений колись список.
 */
export function useRepFilter(storageKey: string) {
  // Читаємо синхронно при першому рендері, а не в ефекті: інакше таблиця встигає
  // блимнути повним списком, перш ніж фільтр застосується.
  const [hidden, setHidden] = useState<string[]>(() => readStored(storageKey));

  const write = (next: string[]) => {
    setHidden(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // приватний режим — фільтр працює до перезавантаження
    }
  };

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  return {
    hiddenIds: hiddenSet,
    setHidden: write,
    /** Лишає в списку тільки видимих; порядок вхідного масиву зберігається. */
    apply: <T extends { id: string }>(list: T[]) => list.filter((r) => !hiddenSet.has(r.id)),
  };
}

export function RepFilter({
  reps,
  hiddenIds,
  onChange,
  label = "Торгові",
}: {
  reps: RepOption[];
  hiddenIds: Set<string>;
  onChange: (hidden: string[]) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Клік поза списком закриває його — випадайка без цього перекриває таблицю
  // і змушує шукати, куди тицьнути.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visibleCount = reps.filter((r) => !hiddenIds.has(r.id)).length;
  const filtering = visibleCount !== reps.length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? reps.filter((r) => r.name.toLowerCase().includes(q)) : reps;
  }, [reps, query]);

  const toggle = (id: string) => {
    const next = new Set(hiddenIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-btn)] border px-3 py-1.5 text-xs font-medium transition-colors ${
          filtering
            ? "border-bk bg-bk text-white"
            : "border-g200 bg-white text-g600 hover:border-g300 hover:text-bk"
        }`}
      >
        {label}: {filtering ? `${visibleCount} з ${reps.length}` : "усі"}
        <span aria-hidden className="text-[10px] opacity-70">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute right-0 z-30 mt-1.5 w-[min(18rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-g200 bg-white p-2 shadow-lg"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук…"
            className="mb-2 w-full rounded-[var(--radius-btn)] border border-g200 px-2 py-1.5 text-xs focus:border-g400 focus:outline-none"
          />

          <div className="max-h-64 overflow-y-auto">
            {shown.length === 0 && <p className="px-2 py-3 text-xs text-g500">Нікого не знайдено.</p>}
            {shown.map((rep) => {
              const checked = !hiddenIds.has(rep.id);
              return (
                <label
                  key={rep.id}
                  className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-btn)] px-2 py-1.5 text-sm text-g600 hover:bg-g100"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(rep.id)}
                    className="cursor-pointer"
                  />
                  <span className="truncate">{rep.name}</span>
                </label>
              );
            })}
          </div>

          <div className="mt-2 flex gap-2 border-t border-g100 pt-2">
            <button
              type="button"
              onClick={() => onChange([])}
              className="cursor-pointer rounded-[var(--radius-btn)] px-2 py-1 text-xs text-g600 transition-colors hover:bg-g100 hover:text-bk"
            >
              Обрати всіх
            </button>
            <button
              type="button"
              onClick={() => onChange(reps.map((r) => r.id))}
              className="cursor-pointer rounded-[var(--radius-btn)] px-2 py-1 text-xs text-g600 transition-colors hover:bg-g100 hover:text-bk"
            >
              Зняти всіх
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
