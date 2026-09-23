"use client";

import { useEffect, useState } from "react";

/**
 * «Підключені AI-застосунки» у профілі адміна.
 *
 * Показує, які claude.ai / ChatGPT мають доступ до даних фірми через
 * MCP-конектор, і дає його відключити. Тут же — адреса конектора для
 * підключення нового застосунку. Докладно: docs/mcp-connector.md.
 */

type Grant = {
  familyId: string;
  clientName: string;
  connectedAt: string;
  lastUsedAt: string | null;
  calls7d: number;
};

const CARD = "rounded-[var(--radius-card)] border border-g200 bg-white p-5";

const when = (iso: string) =>
  new Date(iso).toLocaleString("uk-UA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function McpGrantsCard() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    fetch("/api/admin/mcp-grants")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connectorUrl: string; grants: Grant[] } | null) => {
        if (!d) return;
        setUrl(d.connectorUrl);
        setGrants(d.grants);
      })
      .catch(() => setError("Не вдалося завантажити підключення"));

  useEffect(() => {
    load();
  }, []);

  const revoke = async (g: Grant) => {
    if (!confirm(`Відключити ${g.clientName}? Застосунок втратить доступ до даних і попросить увійти знову.`)) return;
    setError(null);
    setBusy(g.familyId);
    const res = await fetch("/api/admin/mcp-grants", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyId: g.familyId }),
    });
    setBusy(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Не вдалося відключити");
      return;
    }
    await load();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* буфер недоступний — адреса однаково видна в полі */
    }
  };

  return (
    <div className={CARD} id="ai-apps">
      <h2 className="text-[16px] font-bold text-bk">Підключені AI-застосунки</h2>
      <p className="mb-4 mt-0.5 text-[13px] text-g500">
        Claude чи ChatGPT з доступом до даних фірми лише на читання: продажі, борги, склад, логістика.
      </p>

      {grants === null ? (
        <p className="text-[13px] text-g400">Завантажую…</p>
      ) : grants.length === 0 ? (
        <p className="text-[13px] text-g500">Жодного застосунку не підключено.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-g100">
          {grants.map((g) => (
            <li key={g.familyId} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-bk">{g.clientName}</p>
                <p className="text-[12px] text-g500">
                  Підключено {when(g.connectedAt)}
                  {g.lastUsedAt ? ` · востаннє ${when(g.lastUsedAt)}` : ""}
                  {` · запитів за тиждень: ${g.calls7d}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(g)}
                disabled={busy === g.familyId}
                className="min-h-9 rounded-[var(--radius-btn)] border border-g200 px-4 text-[13px] font-semibold text-red-600 transition-colors hover:bg-g50 disabled:opacity-50"
              >
                {busy === g.familyId ? "Відключаю…" : "Відключити"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {url && (
        <div className="mt-4">
          <label className="mb-1.5 block text-[13px] font-semibold text-bk" htmlFor="mcp-url">
            Адреса конектора
          </label>
          <div className="flex gap-2">
            <input
              id="mcp-url"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full min-w-0 rounded-[var(--radius-btn)] border border-g200 bg-g50 px-3.5 py-2.5 font-mono text-[13px] text-bk outline-none"
            />
            <button
              type="button"
              onClick={copy}
              className="min-h-10 shrink-0 rounded-[var(--radius-btn)] bg-bk px-4 text-[13px] font-bold text-primary transition-opacity hover:opacity-90"
            >
              {copied ? "Скопійовано" : "Копіювати"}
            </button>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-g400">
            Claude: Налаштування → Конектори → Додати власний конектор. ChatGPT: Налаштування → Застосунки →
            Розширені → Режим розробника → Створити. Вхід — ваш email і пароль сайту.
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-[13px] font-medium text-red-600">{error}</p>}
    </div>
  );
}
