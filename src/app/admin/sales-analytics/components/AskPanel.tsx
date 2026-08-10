"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";

/**
 * АІ-помічник над цифрами періоду.
 *
 * Модель не має доступу до бази: у неї йде вже пораховане зведення, тож
 * вигадати число вона не може (див. /api/admin/sales-analytics/ask).
 */

const PRESETS = ["Підсумуй період", "Хто відстає і чому", "Які бренди тягнуть виторг", "Помітні аномалії?"];

export function AskPanel({ days }: { days: number }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || asking) return;

    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/admin/sales-analytics/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, days }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Помилка ${res.status}`);
      setAnswer(body.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося отримати відповідь");
    } finally {
      setAsking(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Запитати про цифри" hint="Відповідь рахується з даних за обраний період" />

      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="ask-input" className="sr-only">
          Питання про аналітику
        </label>
        <input
          id="ask-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask(question);
          }}
          placeholder="Наприклад: хто найкраще продає SIGMA?"
          maxLength={500}
          className="flex-1 rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-sm text-bk transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
        />
        <button
          type="button"
          onClick={() => void ask(question)}
          disabled={asking || !question.trim()}
          className="shrink-0 cursor-pointer rounded-[var(--radius-btn)] bg-bk px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-bk-soft disabled:cursor-not-allowed disabled:bg-g300"
        >
          {asking ? "Рахую…" : "Спитати"}
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {PRESETS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              setQuestion(q);
              void ask(q);
            }}
            disabled={asking}
            className="cursor-pointer rounded-full border border-g200 bg-white px-3 py-1.5 text-xs text-g600 transition-colors hover:border-g300 hover:text-bk disabled:cursor-not-allowed disabled:opacity-60"
          >
            {q}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {answer && (
        <div className="mt-3 whitespace-pre-wrap rounded-[var(--radius-card)] border border-g200 bg-g50 p-3 text-sm leading-relaxed text-bk">
          {answer}
        </div>
      )}
    </Card>
  );
}
