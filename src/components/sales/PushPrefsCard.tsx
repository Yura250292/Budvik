"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle, Note } from "@/components/cabinet/ui";
import type { PushCategory } from "@/lib/rep-feed/prefs";

/**
 * Перемикачі категорій пушів стрічки — у профілі торгового.
 *
 * Запобіжник проти єдиної реальної загрози каналу: людині забагато
 * сповіщень, і вона вимикає їх для застосунку цілком — разом із сигналом
 * «підніми трек». Тут можна вимкнути саме те, що заважає. Рядки в стрічці
 * на головній лишаються в будь-якому разі.
 *
 * Зберігається одразу по дотику, без кнопки: перемикач, який треба ще й
 * «зберегти», у полі забувають, і налаштування не діє.
 */

type Prefs = { mutedTypes: string[]; categories: PushCategory[] };

export function PushPrefsCard() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/sales/push-prefs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Prefs) => setPrefs(d))
      .catch(() => setError("Не вдалося прочитати налаштування"));
  }, []);

  const save = async (mutedTypes: string[]) => {
    if (!prefs || busy) return;
    const before = prefs;
    setPrefs({ ...prefs, mutedTypes });
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sales/push-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutedTypes }),
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
    const muted = new Set(prefs.mutedTypes);
    if (muted.has(type)) muted.delete(type);
    else muted.add(type);
    void save([...muted]);
  };

  if (!prefs) return null;

  const anyOn = prefs.mutedTypes.length < prefs.categories.length;

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle big>Сповіщення вдень</CardTitle>
      <Note>
        Оплати, накладні й підказки приходять пушем у робочі години і лише про ваших клієнтів.
        Вимкнене тут лишається в стрічці «Сьогодні» на головній, лише без сповіщення.
      </Note>
      {/* Загальний вимикач — щоб не гасити сім перемикачів по одному. */}
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-cab-line bg-cab-bg px-3 py-2.5">
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-bk">Усі сповіщення стрічки</span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={anyOn}
          checked={anyOn}
          disabled={busy}
          onChange={() => void save(anyOn ? prefs.categories.map((c) => c.type) : [])}
          className="h-6 w-6 shrink-0 accent-[#FFD600]"
        />
      </label>
      <ul className="divide-y divide-cab-line">
        {prefs.categories.map((c) => {
          const on = !prefs.mutedTypes.includes(c.type);
          return (
            <li key={c.type}>
              <label className="flex cursor-pointer items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-bk">{c.label}</span>
                  {c.hint && <span className="block text-xs text-cab-t2">{c.hint}</span>}
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={on}
                  checked={on}
                  disabled={busy}
                  onChange={() => void toggle(c.type)}
                  className="h-6 w-6 shrink-0 accent-[#FFD600]"
                />
              </label>
            </li>
          );
        })}
      </ul>
      {error && <Note tone="bad">{error}</Note>}
    </Card>
  );
}
