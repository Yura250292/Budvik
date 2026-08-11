"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { money, num } from "@/components/ui/Stat";
import { STATUS, type StatusKey } from "@/lib/analytics/colors";
import type { Insight, InsightSeverity, InsightUnit } from "@/lib/ai/insights";

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
  model: string;
  tokens: number;
  generatedAt: string;
  fresh: boolean;
};

type ApiResponse = {
  configured: boolean;
  report: Report | null;
  empty?: string;
  rejected?: number;
  error?: string;
};

const SEVERITY_META: Record<InsightSeverity, { label: string; status: StatusKey }> = {
  critical: { label: "Критично", status: "bad" },
  warning: { label: "Увага", status: "warn" },
  info: { label: "До відома", status: "info" },
  positive: { label: "Добре", status: "good" },
};

/** Найгостріші зверху — керівник читає згори вниз і не мусить шукати. */
const SEVERITY_ORDER: InsightSeverity[] = ["critical", "warning", "info", "positive"];

function formatValue(value: number, unit: InsightUnit): string {
  if (unit === "uah") return `${money(value)} ₴`;
  if (unit === "pct") return `${num(Math.round(value))}%`;
  if (unit === "days") return `${num(value)} дн.`;
  return num(value);
}

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
}: {
  /** Роут із GET (кеш) і POST (генерація) */
  endpoint: string;
  title?: string;
  hint?: string;
}) {
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
  const sorted = [...insights].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

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
        <div className="flex shrink-0 items-center gap-2">
          {report && (
            <span className="text-xs text-g400">
              {report.fresh ? "" : "застаріло · "}
              {formatWhen(report.generatedAt)}
            </span>
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

      {!generating && report && sorted.length === 0 && (
        <div className="mt-3">
          <EmptyState
            title={data?.empty ?? "Нічого вартого уваги"}
            hint={data?.empty ? undefined : "За цей період модель не знайшла ані проблем, ані помітних досягнень."}
          />
        </div>
      )}

      {!generating && sorted.length > 0 && (
        <ul className="mt-3 space-y-2.5">
          {sorted.map((insight, i) => {
            const meta = SEVERITY_META[insight.severity] ?? SEVERITY_META.info;
            const tone = STATUS[meta.status];
            return (
              <li
                key={`${insight.title}-${i}`}
                className="rounded-[var(--radius-card)] border p-3"
                style={{ borderColor: tone.border, backgroundColor: tone.bg }}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className="rounded-[var(--radius-badge)] px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: tone.mark, color: "#fff" }}
                  >
                    {meta.label}
                  </span>
                  <span className="font-semibold text-bk">{insight.title}</span>
                </div>

                <p className="mt-1.5 text-sm text-g600">{insight.detail}</p>

                {insight.evidence.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {insight.evidence.map((e, j) => (
                      <span
                        key={`${e.label}-${j}`}
                        className="inline-flex items-baseline gap-1.5 rounded-[var(--radius-badge)] border border-white/60 bg-white/70 px-2 py-1 text-xs"
                      >
                        <span className="text-g600">{e.label}</span>
                        <span className="font-semibold tabular-nums text-bk">
                          {formatValue(e.value, e.unit)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {insight.action && (
                  <p className="mt-2 text-sm font-medium" style={{ color: tone.fg }}>
                    → {insight.action}
                  </p>
                )}
              </li>
            );
          })}
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
