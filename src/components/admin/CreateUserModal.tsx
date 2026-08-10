"use client";

/**
 * Створення користувача будь-якої робочої ролі.
 *
 * Пароль необов'язковий: складовщик і торговий, що працюють лише через
 * Telegram-бота, живуть без нього (lib/auth.ts не пускає користувача без
 * пароля, тож такий запис просто не логіниться на сайті).
 */

import { useState } from "react";
import { CREATABLE_ROLES, roleLabel } from "@/lib/roles";

export function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "CLIENT",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone || undefined,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error || "Не вдалося створити користувача");
        return;
      }
      // Тезка серед торгових — не помилка, але синхронізація з 1С зіставляє
      // за іменем, тож попередження варте окремого показу.
      if (json.warning) alert(json.warning);
      onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 className="mb-1 text-lg font-bold text-bk">Новий користувач</h2>
        <p className="mb-4 text-[13px] text-g400">
          Пароль потрібен лише для входу на сайт. Складовщики й торгові, які працюють
          через Telegram-бота, можуть лишатися без нього.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-g600" htmlFor="cu-name">
              Ім&apos;я
            </label>
            <input
              id="cu-name"
              required
              value={form.name}
              onChange={set("name")}
              className="w-full rounded-[var(--radius-btn)] border border-g300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {form.role === "SALES" && (
              <p className="mt-1 text-xs text-g400">
                Для торгового пишіть ім&apos;я рівно як у 1С — за ним прив&apos;язуються продажі.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-g600" htmlFor="cu-email">
              Email
            </label>
            <input
              id="cu-email"
              type="email"
              required
              value={form.email}
              onChange={set("email")}
              className="w-full rounded-[var(--radius-btn)] border border-g300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-g600" htmlFor="cu-phone">
                Телефон
              </label>
              <input
                id="cu-phone"
                value={form.phone}
                onChange={set("phone")}
                className="w-full rounded-[var(--radius-btn)] border border-g300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-g600" htmlFor="cu-role">
                Роль
              </label>
              <select
                id="cu-role"
                value={form.role}
                onChange={set("role")}
                className="w-full cursor-pointer rounded-[var(--radius-btn)] border border-g300 bg-white px-3 py-2 text-sm"
              >
                {CREATABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-g600" htmlFor="cu-pass">
              Пароль <span className="font-normal text-g400">— необов&apos;язково</span>
            </label>
            <input
              id="cu-pass"
              type="text"
              autoComplete="new-password"
              minLength={6}
              value={form.password}
              onChange={set("password")}
              placeholder="Мінімум 6 символів"
              className="w-full rounded-[var(--radius-btn)] border border-g300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-[var(--radius-btn)] bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[var(--radius-btn)] bg-g100 px-4 py-2 text-sm font-semibold text-g600 transition-colors hover:bg-g200"
          >
            Скасувати
          </button>
          <button
            type="submit"
            disabled={busy}
            className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-g100 disabled:text-g400"
          >
            {busy ? "Створення…" : "Створити"}
          </button>
        </div>
      </form>
    </div>
  );
}
