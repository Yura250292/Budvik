"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { money } from "@/components/ui/Stat";
import { CATEGORICAL } from "@/lib/analytics/colors";
import type { AskFact } from "@/app/api/admin/sales-analytics/ask/route";

/**
 * АІ-помічник над цифрами періоду.
 *
 * Модель не має доступу до бази: у неї йде вже пораховане зведення, тож
 * вигадати число вона не може (див. /api/admin/sales-analytics/ask).
 *
 * Відповідь показуємо у два шари. Зверху — картки з числами, які прийшли
 * з нашого ж зведення, а не з тексту моделі: саме їх шукає око, коли
 * питання було «порівняй двох». Нижче — пояснення словами. Раніше все
 * було одним абзацом, і щоб порівняти дві суми, їх доводилося вичитувати
 * з речення.
 */

const PRESETS = ["Підсумуй період", "Хто відстає і чому", "Які бренди тягнуть виторг", "Помітні аномалії?"];

type AskResponse = { answer: string; facts?: AskFact[] };

export function AskPanel({ days, from, to }: { days: number; from?: string; to?: string }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || asking) return;

    setAsking(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/sales-analytics/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, days, from, to }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Помилка ${res.status}`);
      setResult({ answer: body.answer, facts: body.facts ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося отримати відповідь");
    } finally {
      setAsking(false);
    }
  }

  const facts = result?.facts ?? [];

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

      {asking && <AskSkeleton />}

      {error && (
        <p role="alert" className="mt-3 rounded-[var(--radius-btn)] bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {result && !asking && (
        <div className="mt-3 space-y-3">
          {facts.length > 0 && <FactGrid facts={facts} />}
          <Answer text={result.answer} />
        </div>
      )}
    </Card>
  );
}

/**
 * Картки порівняння.
 *
 * Смуга під сумою — частка від найбільшого в цій же вибірці, тож
 * відставання видно ще до читання цифр. Лідер підсвічений рамкою:
 * сортування зверху вниз саме по собі читається гірше, ніж явна межа.
 */
function FactGrid({ facts }: { facts: AskFact[] }) {
  const leadGap = facts.length === 2 ? facts[0].amount - facts[1].amount : 0;

  return (
    <div>
      <div className={`grid gap-2 ${facts.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {facts.map((f, i) => {
          const color = CATEGORICAL[i % CATEGORICAL.length];
          const isLead = i === 0 && facts.length > 1;

          return (
            <div
              key={f.name}
              className={`rounded-[var(--radius-card)] border bg-white p-3 ${
                isLead ? "border-g300 shadow-[var(--shadow-card)]" : "border-g200"
              }`}
            >
              <div className="flex items-center gap-2">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="truncate text-xs font-medium text-g600" title={f.name}>
                  {f.name}
                </span>
              </div>

              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-xl font-semibold tabular-nums tracking-tight text-bk">{money(f.amount)}</span>
                <span className="text-xs font-medium text-g500">грн</span>
              </div>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-g100">
                <div
                  className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${Math.max(1.5, f.share)}%`, backgroundColor: color }}
                />
              </div>

              {(f.docs > 0 || f.average > 0) && (
                <p className="mt-1.5 text-xs tabular-nums text-g500">
                  {f.docs > 0 && `${f.docs} замовл.`}
                  {f.docs > 0 && f.average > 0 && " · "}
                  {f.average > 0 && `чек ${money(f.average)} грн`}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {leadGap > 0 && (
        <p className="mt-2 text-xs tabular-nums text-g500">
          Різниця між першим і другим — <span className="font-semibold text-bk">{money(leadGap)} грн</span>
        </p>
      )}
    </div>
  );
}

/**
 * Текст відповіді.
 *
 * Модель нерідко віддає список через «-» або «1.» — рендеримо його
 * списком, а не суцільним рядком. Числа з гривнею виділяємо, бо саме на
 * них зупиняється погляд у довгому реченні.
 */
function Answer({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const isList = lines.length > 1 && lines.every((l) => /^([-–•*]|\d+[.)])\s/.test(l));

  return (
    <div className="rounded-[var(--radius-card)] border border-g200 bg-g50 p-3 text-sm leading-relaxed text-bk">
      {isList ? (
        <ul className="space-y-1.5">
          {lines.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-g400" />
              <span>{highlight(line.replace(/^([-–•*]|\d+[.)])\s*/, ""))}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-2">
          {lines.map((line, i) => (
            <p key={i}>{highlight(line)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Підсвічування сум: «281 895 ₴» / «281 895 грн» стає помітним у реченні. */
function highlight(line: string) {
  const parts = line.split(/(\d[\d\s ]*(?:[.,]\d+)?\s*(?:₴|грн))/g);

  return parts.map((part, i) =>
    /(?:₴|грн)$/.test(part) && /\d/.test(part) ? (
      <span key={i} className="font-semibold tabular-nums text-bk">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/** Скелет замість порожнечі: видно, що саме зараз з'явиться. */
function AskSkeleton() {
  return (
    <div className="mt-3 space-y-3" aria-live="polite" aria-busy="true">
      <span className="sr-only">Рахую відповідь</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-[var(--radius-card)] border border-g200 p-3">
            <div className="h-3 w-24 animate-pulse rounded bg-g100" />
            <div className="mt-2 h-6 w-32 animate-pulse rounded bg-g100" />
            <div className="mt-2 h-1.5 w-full animate-pulse rounded-full bg-g100" />
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-[var(--radius-card)] border border-g200 bg-g50 p-3">
        <div className="h-3 w-full animate-pulse rounded bg-g100" />
        <div className="h-3 w-11/12 animate-pulse rounded bg-g100" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-g100" />
      </div>
    </div>
  );
}
