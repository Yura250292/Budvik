"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { money, num } from "@/components/ui/Stat";
import { STATUS, type StatusKey } from "@/lib/analytics/colors";
import type { Insight } from "@/lib/ai/insights";
import { InsightCard, sortInsights } from "./InsightCard";

/**
 * Картка АІ-інсайтів — спільна для профілю торгового і зрізу команди.
 *
 * Генерація коштує токенів, тож вона за кнопкою, а результат кешується на
 * добу. Мітка «згенеровано …» стоїть завжди: керівник має бачити, що
 * дивиться на вчорашній висновок, а не на щойно порахований.
 *
 * Під кожним інсайтом — рядок чисел, які його підтверджують. Ці числа
 * прийшли з нашого зведення й пройшли валідацію на сервері: інсайт із
 * вигаданою цифрою до інтерфейсу не доходить.
 */

type Report = {
  insights: Insight[];
  /** Зведення, на якому згенеровано — копіюється в архів разом зі звітом */
  facts?: unknown;
  model: string;
  tokens: number;
  generatedAt: string;
  fresh: boolean;
};

/**
 * Що саме зберігати в архів. Панель сама не знає, чий це звіт і за який
 * період — endpoint їй передають рядком, розбирати його було б крихко.
 */
export type SaveContext = {
  kind: "rep" | "team";
  repId?: string | null;
  fromDay: string;
  toDay: string;
};

type ApiResponse = {
  configured: boolean;
  report: Report | null;
  empty?: string;
  rejected?: number;
  error?: string;
};

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function InsightsPanel({
  endpoint,
  title = "АІ-аналіз",
  hint,
  saveContext,
}: {
  /** Роут із GET (кеш) і POST (генерація) */
  endpoint: string;
  title?: string;
  hint?: string;
  /** Без нього кнопки «Зберегти» немає — панель не знає, що відкладати */
  saveContext?: SaveContext;
}) {
  const [saveState, setSaveState] = useState<"idle" | "form" | "saving" | "done">("idle");
  const [saveTitle, setSaveTitle] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Читаємо кеш при зміні періоду. Генерацію не запускаємо самі — це
  // свідомий вибір керівника, а не побічний ефект відкриття сторінки.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(endpoint)
      .then(async (res) => {
        const body = (await res.json()) as ApiResponse;
        if (!res.ok) throw new Error(body.error ?? `Помилка ${res.status}`);
        return body;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = (await res.json()) as ApiResponse;
      if (!res.ok) throw new Error(body.error ?? `Помилка ${res.status}`);
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [endpoint]);

  const report = data?.report ?? null;
  const insights = report?.insights ?? [];
  const sorted = sortInsights(insights);

  // Нова генерація робить попереднє збереження неактуальним: керівник
  // дивиться вже на інші числа, і позначка «збережено» вводила б в оману.
  useEffect(() => {
    setSaveState("idle");
    setSaveError(null);
  }, [report?.generatedAt]);

  const save = useCallback(async () => {
    if (!saveContext || !report) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/sales-analytics/insights/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: saveContext.kind,
          repId: saveContext.repId ?? null,
          fromDay: saveContext.fromDay,
          toDay: saveContext.toDay,
          title: saveTitle,
          note: saveNote,
          insights: report.insights,
          facts: report.facts ?? {},
          model: report.model,
          tokens: report.tokens,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Помилка ${res.status}`);
      setSaveState("done");
      setSaveTitle("");
      setSaveNote("");
    } catch (e) {
      setSaveError((e as Error).message);
      setSaveState("form");
    }
  }, [saveContext, report, saveTitle, saveNote]);

  const canSave = !!saveContext && sorted.length > 0 && !generating;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardHeader
            title={title}
            hint={
              hint ??
              "Висновки робить модель, але всі числа пораховані з бази — вигадану цифру система відкидає."
            }
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {report && (
            <span className="text-xs text-g400">
              {report.fresh ? "" : "застаріло · "}
              {formatWhen(report.generatedAt)}
            </span>
          )}
          {saveContext && (
            <a
              href="/admin/sales-analytics/saved"
              className="cursor-pointer text-[13px] text-g500 underline underline-offset-2 hover:text-bk"
            >
              Архів
            </a>
          )}
          {canSave && saveState !== "form" && (
            <button
              type="button"
              onClick={() => setSaveState("form")}
              disabled={saveState === "saving"}
              className="cursor-pointer rounded-[var(--radius-btn)] border border-g300 px-3 py-2 text-[13px] font-medium text-g600 transition-colors hover:border-g400 hover:text-bk disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveState === "done" ? "Збережено ✓" : saveState === "saving" ? "Зберігаю…" : "Зберегти"}
            </button>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={generating || data?.configured === false}
            className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3.5 py-2 text-[13px] font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? "Аналізую…" : report ? "Оновити аналіз" : "Проаналізувати"}
          </button>
        </div>
      </div>

      {/* Форма збереження: назва й нотатка «нащо відклали». Обидві
          необов'язкові — без назви підпис складеться з виду й періоду. */}
      {saveState === "form" && (
        <div className="mt-3 rounded-[var(--radius-card)] border border-g200 bg-g50 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="Назва (необов'язково)"
              maxLength={120}
              className="rounded-[var(--radius-btn)] border border-g300 bg-white px-3 py-2 text-sm text-bk outline-none focus:border-g400"
            />
            <input
              type="text"
              value={saveNote}
              onChange={(e) => setSaveNote(e.target.value)}
              placeholder="Нащо відкладаєте — напр. «до розмови в понеділок»"
              maxLength={500}
              className="rounded-[var(--radius-btn)] border border-g300 bg-white px-3 py-2 text-sm text-bk outline-none focus:border-g400"
            />
          </div>
          {saveError && (
            <p className="mt-2 text-xs" style={{ color: STATUS.bad.fg }}>
              {saveError}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saveState !== "form"}
              className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Зберегти в архів
            </button>
            <button
              type="button"
              onClick={() => {
                setSaveState("idle");
                setSaveError(null);
              }}
              className="cursor-pointer text-[13px] text-g500 underline underline-offset-2 hover:text-bk"
            >
              Скасувати
            </button>
            <a
              href="/admin/sales-analytics/saved"
              className="ml-auto cursor-pointer text-[13px] text-g500 underline underline-offset-2 hover:text-bk"
            >
              Архів звітів
            </a>
          </div>
        </div>
      )}

      {error && (
        <div
          className="mt-3 rounded-[var(--radius-card)] border p-3 text-sm"
          style={{ borderColor: STATUS.bad.border, backgroundColor: STATUS.bad.bg, color: STATUS.bad.fg }}
        >
          {error}
        </div>
      )}

      {data?.configured === false && !error && (
        <p className="mt-3 text-sm text-g500">
          АІ-аналіз не налаштований: бракує ANTHROPIC_API_KEY. Решта цифр на сторінці працює без нього.
        </p>
      )}

      {loading && (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {generating && (
        <p className="mt-3 text-sm text-g500">
          Модель читає цифри за період. Зазвичай це займає 20–40 секунд.
        </p>
      )}

      {!loading && !generating && !report && !error && data?.configured !== false && (
        <div className="mt-3">
          <EmptyState
            title="Аналіз ще не робили"
            hint="Натисніть «Проаналізувати» — модель прочитає цифри за обраний період і назве те, що варте уваги."
          />
        </div>
      )}

      {/* Порожній результат при витрачених токенах — це збій, а не «все
          спокійно»: модель, яка щось рахувала, не мовчить. Кажемо прямо,
          інакше керівник повірить, що проблем немає. */}
      {!generating && report && sorted.length === 0 && (
        <div className="mt-3">
          <EmptyState
            title={
              data?.empty ??
              (report.tokens > 0 ? "Аналіз не вдався" : "Нічого вартого уваги")
            }
            hint={
              data?.empty
                ? undefined
                : report.tokens > 0
                  ? "Модель відповіла, але список інсайтів не дійшов — найімовірніше, відповідь обірвалася. Натисніть «Оновити аналіз»."
                  : "За цей період модель не знайшла ані проблем, ані помітних досягнень."
            }
          />
        </div>
      )}

      {!generating && sorted.length > 0 && (
        <ul className="mt-3 space-y-2.5">
          {sorted.map((insight, i) => (
            <InsightCard key={`${insight.title}-${i}`} insight={insight} />
          ))}
        </ul>
      )}

      {!generating && report && report.tokens > 0 && (
        <p className="mt-3 text-xs text-g400">
          {report.model} · {num(report.tokens)} токенів
          {data?.rejected ? ` · відкинуто інсайтів через невідповідність цифр: ${data.rejected}` : ""}
        </p>
      )}
    </Card>
  );
}
