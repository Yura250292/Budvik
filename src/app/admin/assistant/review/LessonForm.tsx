"use client";

/**
 * Форма «завести правило» з картки поганої відповіді.
 *
 * Розгортається під карткою, а не модалкою: правило пишеться, дивлячись на
 * відповідь, яку воно має виправити, і перекривати її вікном означало б
 * змусити людину тримати текст у голові.
 *
 * Текст підставляється з «а як мало бути» — це вже слова керівника, і
 * переписувати їх заново не треба. Тригери пропонує сервер з питання;
 * порожній список означає «правило загальне, йде в кожен хід», і це
 * теж робочий вибір, просто дорожчий.
 */

import { useEffect, useState } from "react";
import type { LessonView } from "@/lib/assistant/lessons";

const LESSON_MAX = 200;

const CHIP =
  "cursor-pointer whitespace-nowrap rounded-full border border-g200 bg-white px-3 py-1 text-[12px] font-medium text-g600 transition-colors hover:bg-g50";

type Props = {
  feedbackId: string;
  question: string;
  expected: string | null;
  kind: string | null;
  onDone: () => void;
  onCancel: () => void;
};

export default function LessonForm({ feedbackId, question, expected, kind, onDone, onCancel }: Props) {
  const [text, setText] = useState(expected ?? "");
  const [triggers, setTriggers] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<LessonView[]>([]);
  const [scoped, setScoped] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Тригери й перетини рахує сервер — тими самими правилами, що й відбір. */
  useEffect(() => {
    let alive = true;
    void fetch(`/api/admin/assistant/lessons?suggest=${encodeURIComponent(question)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { triggers?: string[]; conflicts?: LessonView[] } | null) => {
        if (!alive || !d) return;
        setTriggers(d.triggers ?? []);
        setConflicts(d.conflicts ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [question]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/assistant/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, triggers, feedbackId, kind: scoped ? kind : null }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "Не вдалося зберегти правило");
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-g200 bg-g50 px-3 py-3">
      <label className="text-[12px] font-semibold text-g600">
        Правило — одне речення наказовим способом
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, LESSON_MAX))}
        rows={2}
        placeholder="Напр.: у питаннях про закупівлю завжди називай залишок, а не тільки продажі"
        className="w-full rounded-xl border border-g200 bg-white px-3 py-2 text-[13px] outline-none focus:border-bk"
      />
      <div className="flex items-center justify-between text-[11px] text-g500">
        <span>{text.length}/{LESSON_MAX}</span>
        <span>Правило заводиться чернеткою — діяти почне після ввімкнення</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-g500">Спрацьовує на слова:</span>
        {triggers.length === 0 && <span className="text-[12px] font-medium text-amber-700">у кожному питанні</span>}
        {triggers.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTriggers(triggers.filter((x) => x !== t))}
            className="cursor-pointer rounded-full bg-white px-2 py-0.5 text-[12px] font-medium text-g600 ring-1 ring-g200 hover:text-rose-700"
            title="Прибрати"
          >
            {t} ×
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[12px] text-g600">
        <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} />
        Тільки для цього помічника{kind ? ` (${kind})` : ""}
      </label>

      {conflicts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Ті самі слова вже ловлять {conflicts.length} правил{conflicts.length === 1 ? "о" : "а"}:
          <ul className="mt-1 list-disc pl-4">
            {conflicts.map((c) => (
              <li key={c.id}>{c.text}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-[12px] font-medium text-rose-700">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={saving || text.trim().length < 10}
          onClick={() => void save()}
          className="cursor-pointer rounded-full bg-bk px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {saving ? "Зберігаю…" : "Зберегти чернетку"}
        </button>
        <button type="button" onClick={onCancel} className={CHIP}>
          Скасувати
        </button>
      </div>
    </div>
  );
}
