"use client";

/**
 * Telegram водія — вводиться руками, бо привʼязати його інакше нічим.
 *
 * Складовщик і торговий заходять через бота: пишуть /start, отримують код,
 * адмін звіряє його в «Заявках з бота». Для водія такого шляху немає — бот
 * розводить ролі по кнопках, яких у водія немає, і заводити заради одного
 * поля цілу гілку заявок дорожче, ніж вставити id.
 *
 * Звідки взяти id: водій пише боту /start, той відповідає числом. Далі це
 * число сюди — і маршрут із посиланням на Google Maps летить йому в Telegram
 * прямо з картки маршруту.
 *
 * Той самий PATCH, що й у решти полів користувача: він перевіряє, чи цей
 * Telegram не зайнятий кимось іншим (409), і вміє знімати привʼязку.
 */

import { useState } from "react";

export function DriverTelegramCell({
  userId,
  userName,
  telegramId,
  onChanged,
}: {
  userId: string;
  userName: string;
  telegramId: string | null;
  onChanged: (telegramId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(telegramId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не вдалося зберегти");
        return;
      }
      onChanged(data.telegramId ?? null);
      setEditing(false);
    } catch {
      setError("Немає зв'язку — спробуйте ще раз");
    } finally {
      setBusy(false);
    }
  };

  if (telegramId && !editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-[var(--radius-badge)] bg-[#F0FDF4] px-2 py-0.5 text-xs font-semibold text-[#166534]">
          Telegram {telegramId}
        </span>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Відвʼязати Telegram від ${userName}? Маршрути перестануть надходити в чат.`)) {
              save(null);
            }
          }}
          disabled={busy}
          className="cursor-pointer text-xs text-g400 underline-offset-2 hover:text-bk hover:underline"
        >
          відвʼязати
        </button>
      </div>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="cursor-pointer text-xs text-g500 underline underline-offset-2 hover:text-bk"
      >
        + Telegram ID
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          placeholder="123456789"
          inputMode="numeric"
          autoFocus
          className="w-[110px] rounded-[var(--radius-btn)] border border-g200 px-2 py-1 text-xs text-bk"
        />
        <button
          type="button"
          onClick={() => save(draft.trim() || null)}
          disabled={busy}
          className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
        >
          {busy ? "…" : "OK"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft(telegramId ?? "");
            setError(null);
          }}
          className="cursor-pointer px-1 text-xs text-g400 hover:text-bk"
        >
          ✕
        </button>
      </div>
      <span className="text-[11px] text-g400">водій пише боту /start — той назве id</span>
      {error && <span className="text-[11px] text-[#B91C1C]">{error}</span>}
    </div>
  );
}
