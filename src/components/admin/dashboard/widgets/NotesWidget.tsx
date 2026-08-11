"use client";

import { useCallback, useEffect, useState } from "react";
import { WidgetBody } from "./parts";

/**
 * Нотатки-задачі на дашборді.
 *
 * Стан тримається локально й оновлюється оптимістично: чекати відповідь
 * сервера на кожну галочку — це помітна затримка на кожен клік. Якщо
 * запит упав, повертаємо попередній стан і показуємо це користувачу.
 */

type Note = { id: string; text: string; done: boolean; createdAt: string };

const API = "/api/admin/tools/notes";

export function NotesWidget() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(API, { signal });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Помилка завантаження");
      setNotes(json.notes ?? []);
      setError(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Не вдалося завантажити");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");

    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      // Беремо створену нотатку з відповіді: id генерує сервер.
      setNotes((prev) => [json.note, ...prev]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося зберегти");
      setDraft(text);
    }
  };

  const toggle = async (note: Note) => {
    const next = !note.done;
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, done: next } : n)));

    const res = await fetch(API, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: note.id, done: next }),
    }).catch(() => null);

    if (!res?.ok) {
      setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, done: note.done } : n)));
      setError("Не вдалося зберегти зміну");
    }
  };

  const remove = async (note: Note) => {
    const snapshot = notes;
    setNotes((prev) => prev.filter((n) => n.id !== note.id));

    const res = await fetch(`${API}?id=${encodeURIComponent(note.id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setNotes(snapshot);
      setError("Не вдалося видалити");
    }
  };

  const open = notes.filter((n) => !n.done).length;

  return (
    <WidgetBody
      title="Нотатки"
      hint={open > 0 ? `${open} невиконаних` : "Особистий список"}
      loading={loading}
      error={error && notes.length === 0 ? error : null}
    >
      <div className="flex h-full flex-col">
        <form onSubmit={add} className="mb-2 flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Що зробити?"
            maxLength={500}
            className="min-w-0 flex-1 rounded-lg border border-g200 px-2.5 py-1.5 text-[13px] text-bk outline-none placeholder:text-g300 focus:border-g400"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="flex-shrink-0 rounded-lg bg-bk px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity disabled:opacity-30"
          >
            +
          </button>
        </form>

        {/* Помилку показуємо смужкою, а не замість списку: нотатки вже на екрані. */}
        {error && notes.length > 0 && <p className="mb-1 text-[11px] text-[#C62828]">{error}</p>}

        {notes.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-g400">Поки що порожньо</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {notes.map((n) => (
              <li key={n.id} className="group flex items-start gap-2 border-t border-g100 py-1.5">
                <input
                  type="checkbox"
                  checked={n.done}
                  onChange={() => toggle(n)}
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 cursor-pointer accent-bk"
                />
                <span
                  className={`min-w-0 flex-1 break-words text-[13px] ${
                    n.done ? "text-g300 line-through" : "text-bk"
                  }`}
                >
                  {n.text}
                </span>
                <button
                  type="button"
                  onClick={() => remove(n)}
                  aria-label="Видалити"
                  className="flex-shrink-0 text-[13px] leading-none text-g300 opacity-0 transition-opacity hover:text-[#C62828] group-hover:opacity-100"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </WidgetBody>
  );
}
