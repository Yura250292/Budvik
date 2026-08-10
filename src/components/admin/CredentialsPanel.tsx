"use client";

/**
 * Логін і пароль користувача.
 *
 * Раніше жило лише у вкладці «Доступ» торгового представника і працювало
 * тільки для SALES. Тепер той самий віджет обслуговує всі ролі — ендпоінт
 * /api/admin/users/[id]/credentials перевіряє права за PROTECTED_ROLES,
 * а не за шляхом.
 */

import { useEffect, useState } from "react";

type Info = {
  email: string;
  hasPassword: boolean;
  hasTelegram: boolean;
  isPlaceholderEmail: boolean;
};

export function CredentialsPanel({
  userId,
  onClose,
  onSaved,
}: {
  userId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/users/${userId}/credentials`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive || j.error) return;
        setInfo(j);
        setEmail(j.email ?? "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);

    const body: Record<string, string> = {};
    if (info && email !== info.email) body.email = email;
    if (password) body.password = password;

    if (Object.keys(body).length === 0) {
      setError("Змініть email або введіть новий пароль");
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${userId}/credentials`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Не вдалося зберегти");
        return;
      }
      setInfo((p) => (p ? { ...p, email: json.email, hasPassword: json.hasPassword, isPlaceholderEmail: json.isPlaceholderEmail } : p));
      setPassword("");
      setDone(true);
      onSaved?.();
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
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 className="mb-1 text-lg font-bold text-bk">Логін і пароль</h2>
        <p className="mb-4 text-[13px] text-g400">
          {info?.hasTelegram
            ? "Telegram-бот працює незалежно — зміна пароля на нього не впливає."
            : "Потрібно лише для входу на сайт."}
        </p>

        {info?.isPlaceholderEmail && (
          <p className="mb-3 rounded-[var(--radius-btn)] bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            Зараз стоїть технічна пошта — увійти з нею не вийде. Вкажіть справжню.
          </p>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-g600" htmlFor="cred-email">
              Email
            </label>
            <input
              id="cred-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[var(--radius-btn)] border border-g300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-g600" htmlFor="cred-pass">
              Новий пароль{" "}
              <span className="font-normal text-g400">
                {info?.hasPassword ? "— лишіть порожнім, щоб не змінювати" : "— зараз не заданий"}
              </span>
            </label>
            <input
              id="cred-pass"
              type="text"
              autoComplete="new-password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
        {done && (
          <p className="mt-3 rounded-[var(--radius-btn)] bg-green-50 px-3 py-2 text-[13px] text-green-700">
            Збережено.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[var(--radius-btn)] bg-g100 px-4 py-2 text-sm font-semibold text-g600 transition-colors hover:bg-g200"
          >
            Закрити
          </button>
          <button
            type="submit"
            disabled={busy || !info}
            className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-g100 disabled:text-g400"
          >
            {busy ? "Збереження…" : "Зберегти"}
          </button>
        </div>
      </form>
    </div>
  );
}
