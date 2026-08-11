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
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-amber-700">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Не підключено
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-green-700"
        title="Telegram підключено"
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green-500" />
        {telegramUsername ? `@${telegramUsername}` : "Підключено"}
      </span>
      <button
        type="button"
        onClick={unlink}
        disabled={busy}
        className="cursor-pointer text-[11px] font-medium text-g400 underline-offset-2 transition-colors hover:text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-g400"
      >
        {busy ? "…" : "Відв'язати"}
      </button>
    </span>
  );
}
