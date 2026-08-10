"use client";

/**
 * Статус прив'язки до Telegram-бота (@Budvik_Sklad_bot) і відв'язка.
 *
 * Переїхало зі вкладки «Складовщики» у звітах складу: там воно показувалось
 * лише складовщикам, хоча той самий бот обслуговує й торгових.
 *
 * Відв'язка знімає telegramId, але НЕ чіпає роль: людина лишається
 * складовщиком чи торговим, просто більше не заходить через бота.
 */

import { useState } from "react";

export function TelegramBadge({
  userId,
  userName,
  telegramId,
  telegramUsername,
  onUnlinked,
}: {
  userId: string;
  userName: string;
  telegramId?: string | null;
  telegramUsername?: string | null;
  onUnlinked: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const unlink = async () => {
    if (
      !confirm(
        `Відв'язати Telegram від ${userName}?\n\n` +
          "Роль залишиться, але через бота людина більше не зайде — " +
          "щоб повернути доступ, знадобиться нова заявка з /start."
      )
    )
      return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/warehouse-workers?userId=${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error || "Не вдалося відв'язати");
        return;
      }
      onUnlinked();
    } finally {
      setBusy(false);
    }
  };

  if (!telegramId) {
    return (
      <span className="rounded-[var(--radius-btn)] bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
        Не підключено
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="rounded-[var(--radius-btn)] bg-green-50 px-2 py-1 text-xs font-semibold text-green-700">
        Telegram підключено
      </span>
      {telegramUsername && <span className="text-xs text-g400">@{telegramUsername}</span>}
      <button
        type="button"
        onClick={unlink}
        disabled={busy}
        className="cursor-pointer text-xs font-semibold text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:text-g400"
      >
        {busy ? "…" : "Відв'язати"}
      </button>
    </span>
  );
}
