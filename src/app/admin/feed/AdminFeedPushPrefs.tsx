"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import type { PushCategory } from "@/lib/rep-feed/prefs";

/**
 * Які події команди керівник хоче отримувати пушем у застосунок.
 *
 * Типово — жодних: подій сотні на день, стрічку відкривають самі (цифра в
 * меню). Зберігається одразу по дотику, як у торгового в профілі.
 */

type Prefs = { adminTypes: string[]; categories: PushCategory[] };

export default function AdminFeedPushPrefs() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/feed/prefs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Prefs) => setPrefs(d))
      .catch(() => setError("Не вдалося прочитати налаштування"));
  }, []);

  const save = async (adminTypes: string[]) => {
    if (!prefs || busy) return;
    const before = prefs;
    setPrefs({ ...prefs, adminTypes });
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/feed/prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminTypes }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setPrefs(await res.json());
    } catch {
      setError("Не збереглося — спробуйте ще раз");
      setPrefs(before);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (type: string) => {
    if (!prefs) return;
    const on = new Set(prefs.adminTypes);
    if (on.has(type)) on.delete(type);
    else on.add(type);
    void save([...on]);
  };

  const count = prefs?.adminTypes.length ?? 0;

  return (
    <div className="rounded-[var(--radius-card)] border border-g200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left"
      >
        <Bell size={18} className={count > 0 ? "text-bk" : "text-g400"} />
        <span className="flex-1 text-sm font-semibold text-bk">Пуш-сповіщення мені</span>
        <span className="text-[13px] text-g500">{count > 0 ? `увімкнено ${count}` : "вимкнено"}</span>
      </button>
      {open && (
        <div className="border-t border-g100 px-4 pb-3">
          <p className="pt-3 text-[13px] text-g500">
            Пуш у застосунок з 8:00 до 19:00, по всіх торгових, не частіше разу на 5 хвилин і не більше
            20 на день. Решта — у стрічці й цифрою в меню.
          </p>
          {prefs && (
            <ul className="mt-1 divide-y divide-g100">
              {prefs.categories.map((c) => {
                const on = prefs.adminTypes.includes(c.type);
                return (
                  <li key={c.type}>
                    <label className="flex cursor-pointer items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-bk">{c.label}</span>
                        <span className="block text-xs text-g500">{c.hint}</span>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-checked={on}
                        checked={on}
                        disabled={busy}
                        onChange={() => toggle(c.type)}
                        className="h-5 w-5 shrink-0 accent-[#FFD600]"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="pt-2 text-[13px] text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}
