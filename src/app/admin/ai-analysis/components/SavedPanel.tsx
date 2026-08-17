"use client";

/**
 * Збережені звіти АІ-аналізу фірми.
 *
 * Кеш живе добу і прив'язаний до періоду — він рятує від повторної генерації
 * «сьогодні», але не від «покажи, що було в травні». Архів саме про це:
 * звіт лишається назавжди з цифрами того дня, і його можна перечитати
 * скільки завгодно разів, не витрачаючи жодного токена.
 *
 * Список ліворуч, вміст праворуч. Вміст важкий (несе повний фактблоб), тож
 * у переліку приходить лише мета, а сам звіт — окремим запитом на клік.
 * Рендериться тими самими блоками, що й свіжий звіт: збережене й щойно
 * згенероване мають виглядати однаково, інакше архівом не користуються.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { StrategyBlocks } from "./StrategyBlocks";
import { RepBlocks } from "./RepBlocks";
import { ProductBlocks } from "./ProductBlocks";
import { DriverBlocks } from "./DriverBlocks";

type Kind =
  | "company_strategy"
  | "company_reps"
  | "company_products"
  | "company_logistics";

const KIND_LABEL: Record<string, string> = {
  company_strategy: "Стратегія",
  company_reps: "Торгові",
  company_products: "Товари",
  company_logistics: "Логістика",
};

type ListItem = {
  id: string;
  kind: string;
  fromDay: string;
  toDay: string;
  title: string;
  note: string | null;
  model: string;
  tokens: number;
  savedBy: string;
  createdAt: string;
};

type FullReport = ListItem & { insights: unknown; facts: unknown };

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

/** Той самий рендер, що й у свіжого звіту — за видом секції. */
function renderSection(kind: string, payload: unknown, facts: unknown): ReactNode {
  if (kind === "company_reps") return <RepBlocks payload={payload} facts={facts} />;
  if (kind === "company_products") return <ProductBlocks payload={payload} facts={facts} />;
  if (kind === "company_logistics") return <DriverBlocks payload={payload} facts={facts} />;
  return <StrategyBlocks payload={payload} facts={facts} />;
}

export function SavedPanel() {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Kind>("all");

  const [openId, setOpenId] = useState<string | null>(null);
  const [full, setFull] = useState<FullReport | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Один запит на всі види фірми: фільтр на сервері приймає лише один
      // kind, а видів чотири — дешевше відфільтрувати вже отримане.
      const res = await fetch("/api/admin/sales-analytics/insights/saved");
      const body = (await res.json()) as { reports?: ListItem[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Помилка ${res.status}`);
      setItems((body.reports ?? []).filter((r) => r.kind.startsWith("company_")));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loading) return <CardSkeleton rows={6} />;

  const visible = items.filter((i) => filter === "all" || i.kind === filter);

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBox message={error} onRetry={load} />}

      <Card>
        <CardHeader
          title="Збережені звіти"
          hint="Цифри лишаються такими, якими були на момент збереження. Перечитувати можна скільки завгодно — токени не витрачаються."
        />

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", "Усі"],
              ["company_strategy", "Стратегія"],
              ["company_reps", "Торгові"],
              ["company_products", "Товари"],
              ["company_logistics", "Логістика"],
            ] as Array<[typeof filter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`cursor-pointer rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === key
                  ? "bg-bk text-white"
                  : "border border-g200 bg-white text-g600 hover:border-g300 hover:text-bk"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title="Архів порожній"
            hint="Згенеруйте будь-який розділ і натисніть «Зберегти» — звіт залишиться тут назавжди."
          />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-g200">
            {visible.map((item) => {
              const isOpen = openId === item.id;
              return (
                <li key={item.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : item.id)}
                      aria-expanded={isOpen}
                      className="flex min-w-0 flex-1 cursor-pointer flex-col text-left"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge status="neutral">{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                        <span className="truncate text-sm font-medium text-bk">{item.title}</span>
                      </span>
                      <span className="mt-0.5 text-xs text-g500">
                        {item.fromDay} — {item.toDay} · зберіг {item.savedBy} ·{" "}
                        {formatWhen(item.createdAt)}
                      </span>
                      {item.note && (
                        <span className="mt-0.5 text-xs text-g600">{item.note}</span>
                      )}
                    </button>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-g400">
                        {isOpen ? "згорнути" : "відкрити"}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(item.id)}
                        className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-2.5 py-1 text-xs text-g500 transition-colors hover:border-red-300 hover:text-red-700"
                      >
                        Видалити
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-g100 bg-g50 px-4 py-4 sm:px-5">
                      {loadingFull && !full ? (
                        <CardSkeleton rows={4} />
                      ) : full && full.id === item.id ? (
                        <>
                          <p className="mb-3 text-xs text-g500">
                            {full.model} · {full.tokens.toLocaleString("uk-UA")} токенів витрачено
                            при генерації · збережено {formatWhen(full.createdAt)}
                          </p>
                          {renderSection(full.kind, full.insights, full.facts)}
                        </>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
