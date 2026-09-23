"use client";

/**
 * Розбір помічника: що він відповів погано і що з цим робити.
 *
 * Тут навмисно НЕМА статистики — ні графіків, ні часток. За весь час у
 * базі кількасот відповідей, і будь-який відсоток на такому обсязі
 * показував би погоду на Марсі. Екран — черга одиничних випадків,
 * найсвіжіші згори.
 *
 * Головна колонка картки — не текст відповіді, а рядок знаків: хто
 * відповів, скільки чисел не знайшлося в даних, які інструменти
 * відпрацювали. Саме за ними видно, чи це питання до моделі, чи до коду.
 */

import { useState } from "react";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { ReviewRow } from "@/lib/assistant/feedback";
import LessonForm from "./LessonForm";

const FILTERS = [
  { key: "NEW", label: "Нові" },
  { key: "TRIAGED", label: "Розібрані" },
  { key: "WONTFIX", label: "Не помилка" },
  { key: "", label: "Усі" },
] as const;

const CHIP = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
    active ? "border-bk bg-bk text-white" : "border-g200 bg-white text-g600 hover:bg-g50"
  }`;

/** Людські підписи сигналів: у базі вони латиницею, на екрані — ні. */
const SIGNAL_LABEL: Record<string, string> = {
  codeMiss: "код не знайшов",
  toolError: "інструмент упав",
  emptyResult: "порожня видача",
  strippedLinks: "вигадані посилання",
  unverified: "числа поза даними",
  fallback: "запасна модель",
  truncated: "відповідь обірвано",
  clarifyTwice: "уточнення двічі",
  reask: "перепитали те саме",
  turnFailed: "хід упав",
};

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Не вдалося завантажити");
  return res.json();
};

export default function ReviewScreen() {
  const [status, setStatus] = useState<string>("NEW");
  const [verdict, setVerdict] = useState("");
  const [codeOnly, setCodeOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  /** Чия картка зараз заводить правило. */
  const [ruling, setRuling] = useState<string | null>(null);
  /** Що вже поїхало в регресію цього сеансу — щоб кнопка не кликала двічі. */
  const [inSuite, setInSuite] = useState<Set<string>>(new Set());

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (verdict) params.set("verdict", verdict);
  if (codeOnly) params.set("code", "1");

  const { data, error, isLoading, mutate } = useSWR(`/api/admin/assistant/review?${params}`, getJson<{ items: ReviewRow[] }>);
  const items = data?.items ?? [];

  async function mark(id: string, next: string) {
    await fetch("/api/admin/assistant/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    });
    void mutate();
  }

  /**
   * У регресійний набір.
   *
   * Кейс складає сервер зі знімка ходу: які інструменти відпрацювали, чи
   * йшло через модель, які блоки намалювались. Очікування описують ФОРМУ,
   * а не числа, — завтрашня дебіторка інша, ніж сьогоднішня.
   */
  async function toSuite(id: string, golden: boolean) {
    const res = await fetch("/api/admin/assistant/eval-cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedbackId: id, golden }),
    });
    if (res.ok) {
      setInSuite((prev) => new Set(prev).add(id));
      void mark(id, "TEST");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold leading-tight text-bk">Розбір помічника</h1>
        <p className="mt-0.5 text-[13px] text-g500">
          Відповіді, які ви позначили як невдалі, і ті, де помічник сам помітив проблему: не знайшов даних, упав
          інструмент, назвав числа, яких немає у видачі. З розібраного народжуються правила.
        </p>
        <a href="/admin/assistant/lessons" className="mt-1 inline-block text-[13px] font-semibold text-bk underline">
          Правила помічника →
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setStatus(f.key)} className={CHIP(status === f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setVerdict(verdict === "BAD" ? "" : "BAD")} className={CHIP(verdict === "BAD")}>
          Лише 👎
        </button>
        <button type="button" onClick={() => setCodeOnly(!codeOnly)} className={CHIP(codeOnly)}>
          Лише без моделі
        </button>
      </div>

      {error && <ErrorBox message="Не вдалося завантажити чергу розбору" onRetry={() => void mutate()} />}
      {!error && isLoading && <p className="text-[13px] text-g500">Завантажую…</p>}

      {!error && !isLoading && items.length === 0 && (
        <EmptyState title="Порожньо" hint="Тут з'являться невдалі відповіді помічника — ваші оцінки й те, що він помітив сам." />
      )}

      {items.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {r.verdict === "BAD" && <span className="rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">👎</span>}
              {r.verdict === "GOOD" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">👍</span>}
              {r.source === "AUTO" && <span className="rounded-full bg-g50 px-2 py-0.5 font-medium text-g600">помітив сам</span>}
              {r.signals.map((s) => (
                <span key={s} className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                  {SIGNAL_LABEL[s] ?? s}
                </span>
              ))}
            </div>

            <p className="text-[15px] font-semibold text-bk">{r.question || "(питання не збереглося)"}</p>

            {r.expected && (
              <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] text-sky-900">
                Мало бути: {r.expected}
              </p>
            )}

            <p className="text-[13px] whitespace-pre-wrap text-g600">
              {open === r.id ? r.answer : `${r.answer.slice(0, 260)}${r.answer.length > 260 ? "…" : ""}`}
            </p>
            {r.answer.length > 260 && (
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="self-start text-[12px] font-semibold text-g600 underline">
                {open === r.id ? "Згорнути" : "Показати повністю"}
              </button>
            )}

            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-g500">
              <span>{r.viaModel ? (r.model ?? "модель") : `без моделі${r.intent ? ` · намір ${r.intent}` : ""}`}</span>
              {r.durationMs != null && <span>{(r.durationMs / 1000).toFixed(1)} с</span>}
              {r.rounds > 0 && <span>раундів {r.rounds}</span>}
              {r.promptTokens > 0 && <span>{Math.round((r.promptTokens + r.completionTokens) / 1000)} тис. токенів</span>}
              {r.numbersChecked > 0 && (
                <span className={r.numbersUnverified > 0 ? "font-semibold text-amber-700" : undefined}>
                  числа {r.numbersChecked - r.numbersUnverified}/{r.numbersChecked}
                </span>
              )}
              {r.toolTrace.length > 0 && <span>{r.toolTrace.map((t) => `${t.name}${t.ok ? "" : " ✗"}`).join(", ")}</span>}
            </div>

            {!r.viaModel && (
              <p className="rounded-xl border border-g200 bg-g50 px-3 py-2 text-[12px] text-g600">
                Цю відповідь склав код, а не модель. Правило для моделі її не змінить — треба правити роутер.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {r.status !== "TRIAGED" && (
                <button type="button" onClick={() => void mark(r.id, "TRIAGED")} className={CHIP(false)}>
                  Розібрано
                </button>
              )}
              {r.status !== "WONTFIX" && (
                <button type="button" onClick={() => void mark(r.id, "WONTFIX")} className={CHIP(false)}>
                  Не помилка
                </button>
              )}
              {r.status !== "NEW" && (
                <button type="button" onClick={() => void mark(r.id, "NEW")} className={CHIP(false)}>
                  Повернути в чергу
                </button>
              )}
              {r.viaModel && ruling !== r.id && (
                <button type="button" onClick={() => setRuling(r.id)} className={CHIP(false)}>
                  Завести правило
                </button>
              )}
              {!inSuite.has(r.id) && (
                <button type="button" onClick={() => void toSuite(r.id, r.verdict === "GOOD")} className={CHIP(false)}>
                  {r.verdict === "GOOD" ? "В еталони" : "У регресію"}
                </button>
              )}
              {inSuite.has(r.id) && <span className="self-center text-[12px] text-g500">у наборі ✓</span>}
              {r.threadId && (
                <a href={`/admin/assistant?t=${r.threadId}`} className={CHIP(false)}>
                  Відкрити розмову
                </a>
              )}
            </div>

            {ruling === r.id && (
              <LessonForm
                feedbackId={r.id}
                question={r.question}
                expected={r.expected}
                kind={r.kind}
                onDone={() => {
                  setRuling(null);
                  void mark(r.id, "RULED");
                }}
                onCancel={() => setRuling(null)}
              />
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
