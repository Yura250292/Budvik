"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { num } from "@/components/ui/Stat";
import { STATUS } from "@/lib/analytics/colors";
import { InsightCard, sortInsights } from "../../components/InsightCard";
import { ErrorBox } from "../../components/ErrorBox";
import type { Insight } from "@/lib/ai/insights";

/**
 * Архів збережених АІ-звітів.
 *
 * Список ліворуч, вміст обраного праворуч. Звіти важкі (кожен несе повне
 * зведення), тож у списку приходить лише мета — вміст довантажується на
 * клік, окремим запитом.
 *
 * Сенс архіву в порівнянні: той самий період можна відкласти двічі з
 * різницею в місяць і побачити, що змінилося. Тому записи не групуються
 * і не дедуплікуються — кожне збереження окремим рядком, найновіші зверху.
 */

type ListItem = {
  id: string;
  kind: "rep" | "team";
  repId: string | null;
  repName: string | null;
  fromDay: string;
  toDay: string;
  title: string;
  note: string | null;
  model: string;
  tokens: number;
  savedBy: string;
  createdAt: string;
  insightsCount: number;
};

type FullReport = ListItem & { insights: Insight[] };

type Filter = "all" | "team" | "rep";

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function SavedReports() {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const [openId, setOpenId] = useState<string | null>(null);
  const [full, setFull] = useState<FullReport | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sales-analytics/insights/saved");
      const body = (await res.json()) as { reports?: ListItem[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Помилка ${res.status}`);
      setItems(body.reports ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Вміст обраного звіту. Окремим запитом, бо в списку його навмисно немає.
  useEffect(() => {
    if (!openId) {
      setFull(null);
      return;
    }
    let cancelled = false;
    setLoadingFull(true);
    fetch(`/api/admin/sales-analytics/insights/saved/${openId}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Помилка ${res.status}`);
        return body as FullReport;
      })
      .then((body) => {
        if (!cancelled) setFull(body);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingFull(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Видалити цей звіт з архіву? Дію не можна скасувати.")) return;
      try {
        const res = await fetch(`/api/admin/sales-analytics/insights/saved/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Помилка ${res.status}`);
        }
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (openId === id) setOpenId(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [openId]
  );

  const visible = items.filter((i) => filter === "all" || i.kind === filter);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-g200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/admin/sales-analytics"
              aria-label="Назад до аналітики"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-btn)] border border-g200 text-g600 transition-colors hover:border-g300 hover:text-bk"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight text-bk sm:text-xl">
                Архів АІ-звітів
              </h1>
              <p className="truncate text-xs text-g400">
                Збережені висновки — цифри лишаються такими, якими були на момент збереження
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-4 px-4 pt-4 pb-10 sm:px-6">
        {error && <ErrorBox message={error} onRetry={load} />}

        <div className="flex flex-wrap gap-1">
          {(
            [
              ["all", "Усі"],
              ["team", "По команді"],
              ["rep", "По торгових"],
            ] as Array<[Filter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`cursor-pointer rounded-[var(--radius-btn)] px-3.5 py-2 text-[13px] font-medium transition-colors ${
                filter === key ? "bg-bk text-white" : "text-g600 hover:bg-g100 hover:text-bk"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && <CardSkeleton rows={5} />}

        {!loading && visible.length === 0 && (
          <Card>
            <EmptyState
              title="Архів порожній"
              hint="Згенеруйте аналіз на вкладці «Торгові → Порівняння» або в профілі торгового і натисніть «Зберегти»."
            />
          </Card>
        )}

        {!loading && visible.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
            {/* --- Список --- */}
            <Card padded={false}>
              <div className="p-4 sm:p-5">
                <CardHeader
                  title={`Збережено: ${visible.length}`}
                  hint="Найновіші зверху. Один період може зустрічатися кілька разів — саме для порівняння «було / стало»."
                />
              </div>
              <ul className="max-h-[70vh] divide-y divide-g100 overflow-auto border-t border-g100">
                {visible.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(item.id === openId ? null : item.id)}
                      aria-current={item.id === openId ? "true" : undefined}
                      className={`w-full cursor-pointer px-4 py-3 text-left transition-colors ${
                        item.id === openId ? "bg-g50" : "hover:bg-g50"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-medium text-bk">{item.title}</span>
                        <span className="shrink-0 text-xs text-g400">
                          {item.insightsCount} інс.
                        </span>
                      </div>
                      <span className="mt-0.5 block text-xs text-g500">
                        {item.kind === "team" ? "Команда" : (item.repName ?? "Торговий")} ·{" "}
                        {item.fromDay} — {item.toDay}
                      </span>
                      {item.note && (
                        <span className="mt-1 block text-xs italic text-g500">{item.note}</span>
                      )}
                      <span className="mt-1 block text-xs text-g400">
                        {formatWhen(item.createdAt)} · {item.savedBy}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>

            {/* --- Вміст обраного --- */}
            <div>
              {!openId && (
                <Card>
                  <EmptyState
                    title="Оберіть звіт зі списку"
                    hint="Зліва — усе, що відклали. Клік відкриє висновки з цифрами на момент збереження."
                  />
                </Card>
              )}

              {openId && loadingFull && (
                <Card>
                  <Skeleton className="h-16 w-full" />
                  <div className="mt-2 space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                </Card>
              )}

              {openId && !loadingFull && full && (
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardHeader
                        title={full.title}
                        hint={`${full.kind === "team" ? "Команда" : (full.repName ?? "Торговий")} · період ${full.fromDay} — ${full.toDay} · збережено ${formatWhen(full.createdAt)} (${full.savedBy})`}
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {full.kind === "rep" && full.repId && (
                        <Link
                          href={`/admin/sales-analytics/${full.repId}?from=${full.fromDay}&to=${full.toDay}`}
                          className="cursor-pointer rounded-[var(--radius-btn)] border border-g300 px-3 py-2 text-[13px] font-medium text-g600 transition-colors hover:border-g400 hover:text-bk"
                        >
                          Свіжі дані
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(full.id)}
                        className="cursor-pointer rounded-[var(--radius-btn)] border px-3 py-2 text-[13px] font-medium transition-colors"
                        style={{ borderColor: STATUS.bad.border, color: STATUS.bad.fg }}
                      >
                        Видалити
                      </button>
                    </div>
                  </div>

                  {full.note && (
                    <p className="mt-2 rounded-[var(--radius-card)] border border-g200 bg-g50 p-2.5 text-sm italic text-g600">
                      {full.note}
                    </p>
                  )}

                  {full.insights.length === 0 ? (
                    <div className="mt-3">
                      <EmptyState title="У звіті немає інсайтів" />
                    </div>
                  ) : (
                    <ul className="mt-3 space-y-2.5">
                      {sortInsights(full.insights).map((insight, i) => (
                        <InsightCard key={`${insight.title}-${i}`} insight={insight} />
                      ))}
                    </ul>
                  )}

                  {full.tokens > 0 && (
                    <p className="mt-3 text-xs text-g400">
                      {full.model} · {num(full.tokens)} токенів
                    </p>
                  )}
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
