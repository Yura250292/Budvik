"use client";

/**
 * Заявка на підключення з Telegram-бота.
 *
 * Працівник надсилає /start, бот показує 6-значний код (діє 24 год), адмін
 * звіряє код і призначає роль. Сам бот роль НЕ ставить: у момент /start він
 * ще не знає, хто це, а самопризначення зламало б гейт requireWorker.
 *
 * Порядок полів не косметичний: роль обирається ПЕРШОЮ, бо від неї залежать
 * кнопки в боті і за нею фільтрується список кандидатів. Той самий порядок
 * описаний в docs/sklad-instrukciya-admin.md.
 */

import { useState } from "react";

function formatDateTime(value: string): string {
  const d = new Date(value);
  return d.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Candidate = { id: string; name: string; email: string; role: string; telegramId?: string | null };

export type LinkRequest = {
  id: string;
  code: string;
  telegramName?: string | null;
  telegramUsername?: string | null;
  createdAt: string;
};

/** Ролі, які видає бот. ADMIN/MANAGER свідомо відсутні — прив'язка не має бути шляхом підвищення прав. */
const BOT_ROLES = [
  { value: "WAREHOUSE", label: "Складовщик", hint: "зміни та накладні" },
  { value: "SALES", label: "Торговий", hint: "поїздки, чекпоінти, пробіг" },
] as const;

export function LinkRequestCard({
  request,
  candidates,
  onApproved,
}: {
  request: LinkRequest;
  candidates: Candidate[];
  onApproved: () => void;
}) {
  const [role, setRole] = useState<string>("WAREHOUSE");
  const [target, setTarget] = useState<string>("");
  const [draft, setDraft] = useState({ name: "", email: "" });
  const [busy, setBusy] = useState(false);

  const roleHint = BOT_ROLES.find((r) => r.value === role)?.hint ?? "";
  const roleLabelLower = role === "SALES" ? "торгового" : "складовщика";

  // Кандидати — лише без прив'язки і з тією ж роллю: інакше адмін обрав би
  // людину, якій прив'язка тихо змінила б роль.
  const eligible = candidates.filter((c) => !c.telegramId && c.role === role);

  const approve = async () => {
    const body: Record<string, unknown> = { requestId: request.id, role };

    if (target && target !== "NEW") {
      body.userId = target;
    } else {
      if (!draft.name.trim() || !draft.email.trim()) {
        alert(`Вкажіть ім'я та email нового ${roleLabelLower}`);
        return;
      }
      body.name = draft.name.trim();
      body.email = draft.email.trim();
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/warehouse-workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Не вдалося підтвердити заявку");
        return;
      }
      onApproved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-g100 py-3 first:border-t-0">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="rounded-[var(--radius-btn)] bg-primary/15 px-2.5 py-1 font-mono text-lg font-bold tracking-wider text-bk">
          {request.code}
        </span>
        <span className="text-sm font-semibold text-bk">
          {request.telegramName || "Без імені"}
        </span>
        {request.telegramUsername && (
          <span className="text-[13px] text-g400">@{request.telegramUsername}</span>
        )}
        <span className="text-xs text-g400">{formatDateTime(request.createdAt)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`role-${request.id}`}>
          Роль
        </label>
        <select
          id={`role-${request.id}`}
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            // Скидаємо кандидата: список під іншу роль уже інший.
            setTarget("");
          }}
          className="cursor-pointer rounded-[var(--radius-btn)] border border-g300 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-bk"
        >
          {BOT_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Кому призначити"
          className="cursor-pointer rounded-[var(--radius-btn)] border border-g300 bg-white px-2.5 py-1.5 text-[13px] text-bk"
        >
          <option value="">— Оберіть {roleLabelLower} —</option>
          {eligible.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.email})
            </option>
          ))}
          <option value="NEW">+ Створити нового</option>
        </select>

        {target === "NEW" && (
          <>
            <input
              placeholder="Ім'я"
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              className="rounded-[var(--radius-btn)] border border-g300 px-2.5 py-1.5 text-[13px]"
            />
            <input
              placeholder="Email"
              value={draft.email}
              onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))}
              className="rounded-[var(--radius-btn)] border border-g300 px-2.5 py-1.5 text-[13px]"
            />
          </>
        )}

        <button
          type="button"
          onClick={approve}
          disabled={busy || !target}
          className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-g100 disabled:text-g400"
        >
          {busy ? "…" : "Підтвердити"}
        </button>
      </div>

      <p className="mt-1.5 text-xs text-g400">
        Роль обирайте до вибору працівника — від неї залежать кнопки в боті ({roleHint}).
      </p>
    </div>
  );
}
