"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

/**
 * Коментарі про клієнта: що торговий знає, чого немає в цифрах.
 *
 * Стрічка з автором і датою, а не одне спільне поле нотаток: інакше
 * останній, хто писав, затирає попереднього, і незрозуміло, чия це
 * домовленість і коли вона була.
 */

type Comment = {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; name: string };
  canEdit: boolean;
};

const dt = new Intl.DateTimeFormat("uk-UA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ClientCommentsModal({
  client,
  onClose,
}: {
  client: { id: string; name: string };
  onClose: () => void;
}) {
  const { data: session } = useSession();
  const { data, loading, error, reload } = useApi<{ comments: Comment[] }>(
    `/api/admin/client-comments/${client.id}`
  );

  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc закриває: модалка перекриває карту, і тягтися до хрестика незручно.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    const value = (editing ? editing.text : text).trim();
    if (!value) return;

    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(
        editing
          ? `/api/admin/client-comments/comment/${editing.id}`
          : `/api/admin/client-comments/${client.id}`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: value }),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setText("");
      setEditing(null);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не вдалося зберегти коментар");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/client-comments/comment/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не вдалося видалити коментар");
    } finally {
      setBusy(false);
    }
  };

  const comments = data?.comments ?? [];

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-[var(--radius-card)] bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-bk">{client.name}</h3>
            <p className="text-xs text-gr">Коментарі торгових: домовленості, особливості, чого чекати</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="ml-auto shrink-0 rounded-[var(--radius-btn)] border border-line px-2 py-0.5 text-sm text-bk"
          >
            ✕
          </button>
        </div>

        {/* Форма: зверху, бо найчастіше сюди заходять саме дописати */}
        <div className="mb-3">
          <textarea
            ref={inputRef}
            value={editing ? editing.text : text}
            onChange={(e) =>
              editing ? setEditing({ ...editing, text: e.target.value }) : setText(e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            rows={3}
            maxLength={2000}
            placeholder="Наприклад: бере лише по понеділках, просив дзвонити зранку, конкурент возить дешевшу суху суміш"
            className="w-full rounded-[var(--radius-btn)] border border-line px-2.5 py-1.5 text-sm text-bk"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !(editing ? editing.text : text).trim()}
              className="rounded-[var(--radius-btn)] bg-bk px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {editing ? "Зберегти" : "Додати"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-[var(--radius-btn)] border border-line px-3 py-1.5 text-sm text-bk"
              >
                Скасувати
              </button>
            )}
            <span className="ml-auto text-xs text-gr">Ctrl+Enter — зберегти</span>
          </div>
        </div>

        {actionError && <div className="mb-3"><ErrorBox message={actionError} /></div>}
        {error && <div className="mb-3"><ErrorBox message={error} onRetry={reload} /></div>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !data && <p className="text-sm text-gr">Завантаження…</p>}
          {!loading && comments.length === 0 && (
            <p className="text-sm text-gr">
              Коментарів ще немає. Перший запис тут побачить кожен, хто відкриє цього клієнта.
            </p>
          )}
          <ul className="space-y-2.5">
            {comments.map((c) => (
              <li key={c.id} className="rounded-[var(--radius-card)] border border-line px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-gr">
                  <span className="font-medium text-bk">{c.author.name}</span>
                  <span>{dt.format(new Date(c.createdAt))}</span>
                  {c.author.id === session?.user?.id && <span>· ваш</span>}
                  {c.canEdit && (
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: c.id, text: c.text })}
                        className="underline"
                      >
                        Змінити
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        disabled={busy}
                        className="text-rd underline disabled:opacity-50"
                      >
                        Видалити
                      </button>
                    </span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-bk">{c.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
