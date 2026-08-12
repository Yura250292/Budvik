"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { money, num } from "@/components/ui/Stat";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { STATUS, CATEGORICAL } from "@/lib/analytics/colors";
import { useApi } from "../../components/useApi";
import { ErrorBox } from "../../components/ErrorBox";
import type { ClientState } from "@/lib/analytics/clients";

/**
 * Динаміка й портфель клієнтів торгового.
 *
 * Два блоки в одному компоненті, бо живляться однією відповіддю: обидва
 * відповідають на питання «як змінюється робота», і показувати їх за різні
 * періоди не можна.
 *
 * Головне тут — не оборот (він уже є вище на картці), а рух: хто з'явився,
 * хто вибивається з власного ритму, хто зник. Саме цих рядків немає ніде
 * в іншому місці дашборда.
 */

type PortfolioResponse = {
  period: { from: string; to: string; days: number };
  rep: { id: string; name: string | null };
  portfolio: {
    repId: string;
    clients: Array<{
      counterpartyId: string;
      name: string;
      firstDocAt: string;
      lastDocAt: string;
      daysSinceLast: number;
      docs: number;
      amount: number;
      avgIntervalDays: number;
      skuCount: number;
      brandCount: number;
      receivable: number;
      overdue: number;
      state: ClientState;
    }>;
    counts: Record<ClientState, number>;
    newRevenue: number;
    lostRevenue: number;
    totalClients: number;
  };
  trend: {
    weekly: Array<{ bucket: string; amount: number; docs: number; clients: number; avgCheck: number }>;
    monthly: Array<{ bucket: string; amount: number; docs: number; clients: number; avgCheck: number }>;
    momentum: {
      recent: { amount: number; docs: number; clients: number; avgCheck: number };
      previous: { amount: number; docs: number; clients: number; avgCheck: number };
      amountDeltaPct: number;
      docsDeltaPct: number;
      avgCheckDeltaPct: number;
      clientsDeltaPct: number;
      comparable: boolean;
      recentFrom: string;
      previousFrom: string;
    };
  };
};

/** Підписи станів. Формулювання — те, яким керівник говорить із торговим. */
const STATE_META: Record<
  ClientState,
  { label: string; hint: string; color: string; status: "good" | "warn" | "bad" | "neutral" | "info" }
> = {
  NEW: { label: "Нові", hint: "перше замовлення в цьому періоді", color: CATEGORICAL[2], status: "good" },
  ACTIVE: { label: "Активні", hint: "беруть у своєму звичному ритмі", color: CATEGORICAL[0], status: "neutral" },
  SLIPPING: { label: "Збиваються з ритму", hint: "мовчать довше, ніж зазвичай", color: CATEGORICAL[3], status: "warn" },
  DORMANT: { label: "Сплять", hint: "60+ днів без замовлення", color: CATEGORICAL[1], status: "warn" },
  LOST: { label: "Втрачені", hint: "90+ днів без замовлення", color: CATEGORICAL[7], status: "bad" },
};

const STATE_ORDER: ClientState[] = ["NEW", "ACTIVE", "SLIPPING", "DORMANT", "LOST"];

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(iso));
}

/**
 * Зміна у відсотках зі знаком і кольором.
 *
 * Для метрик, де падіння — це погано (оборот, чек), колір відповідає
 * напрямку. Порівнювати нема з чим — показуємо прочерк, а не нуль.
 */
function DeltaValue({ percent, comparable }: { percent: number; comparable: boolean }) {
  if (!comparable) return <span className="text-sm text-g400">н/д</span>;

  const rounded = Math.round(percent);
  const color = rounded > 2 ? STATUS.good.fg : rounded < -2 ? STATUS.bad.fg : "var(--color-g500)";
  const sign = rounded > 0 ? "+" : "";

  return (
    <span className="text-sm font-semibold tabular-nums" style={{ color }}>
      {sign}
      {rounded}%
    </span>
  );
}

function MomentumTile({
  label,
  recent,
  previous,
  percent,
  comparable,
  format,
}: {
  label: string;
  recent: number;
  previous: number;
  percent: number;
  comparable: boolean;
  format: (v: number) => string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-g200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-g500">{label}</span>
        <DeltaValue percent={percent} comparable={comparable} />
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums text-bk">{format(recent)}</div>
      <p className="mt-0.5 text-xs text-g500">було {format(previous)}</p>
    </div>
  );
}

export function PortfolioSection({ repId, period }: { repId: string; period: { from: string; to: string } }) {
  const { data, loading, error, reload } = useApi<PortfolioResponse>(
    `/api/admin/sales-analytics/portfolio/${repId}?from=${period.from}&to=${period.to}`
  );
  const [stateFilter, setStateFilter] = useState<ClientState | "ALL">("ALL");

  const clients = useMemo(() => {
    if (!data) return [];
    const list =
      stateFilter === "ALL"
        ? data.portfolio.clients
        : data.portfolio.clients.filter((c) => c.state === stateFilter);
    // Тих, хто відвалюється, сортуємо за оборотом: втратити великого
    // клієнта дорожче, ніж дрібного, і саме з нього треба починати.
    return [...list].sort((a, b) => b.amount - a.amount).slice(0, 100);
  }, [data, stateFilter]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <CardSkeleton rows={6} />;
  if (!data) return null;

  const { portfolio, trend } = data;
  const { momentum } = trend;
  const hasClients = portfolio.totalClients > 0;

  return (
    <>
      {/* --- Темп: останні 4 тижні проти попередніх --- */}
      {/* id-якорі — цілі посилань «джерело» з АІ-інсайтів */}
      <div id="rep-dynamics" className="scroll-mt-20">
      <Card>
        <CardHeader
          title="Темп роботи"
          hint={
            momentum.comparable
              ? `Останні 4 тижні (з ${formatDate(momentum.recentFrom)}) проти попередніх 4 (з ${formatDate(momentum.previousFrom)}). Не залежить від обраного періоду.`
              : "Порівняти нема з чим: попередні 4 тижні виходять за межі наявної історії."
          }
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MomentumTile
            label="Оборот"
            recent={momentum.recent.amount}
            previous={momentum.previous.amount}
            percent={momentum.amountDeltaPct}
            comparable={momentum.comparable}
            format={(v) => `${money(v)} ₴`}
          />
          <MomentumTile
            label="Реалізацій"
            recent={momentum.recent.docs}
            previous={momentum.previous.docs}
            percent={momentum.docsDeltaPct}
            comparable={momentum.comparable}
            format={(v) => num(v)}
          />
          <MomentumTile
            label="Середній чек"
            recent={momentum.recent.avgCheck}
            previous={momentum.previous.avgCheck}
            percent={momentum.avgCheckDeltaPct}
            comparable={momentum.comparable}
            format={(v) => `${money(v)} ₴`}
          />
          <MomentumTile
            label="Клієнтів"
            recent={momentum.recent.clients}
            previous={momentum.previous.clients}
            percent={momentum.clientsDeltaPct}
            comparable={momentum.comparable}
            format={(v) => num(v)}
          />
        </div>

        {trend.monthly.length > 1 && (
          <div className="mt-4 border-t border-g100 pt-3">
            <p className="mb-2 text-xs font-medium text-g500">По місяцях</p>
            <div className="flex flex-wrap gap-2">
              {trend.monthly.map((m) => (
                <span
                  key={m.bucket}
                  className="inline-flex items-baseline gap-1.5 rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-xs"
                >
                  <span className="text-g600">{m.bucket.slice(0, 7)}</span>
                  <span className="font-semibold tabular-nums text-bk">{money(m.amount)}</span>
                  <span className="text-g400">· {m.docs} док.</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>
      </div>

      {/* --- Портфель клієнтів --- */}
      <div id="rep-portfolio" className="scroll-mt-20">
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Портфель клієнтів"
            hint="Стан рахується за датою останнього документа: візитів у базі ще немає, тож ритм роботи з клієнтом визначаємо за відвантаженнями."
          />

          {!hasClients ? (
            <EmptyState title="Клієнтів немає" hint="За цим торговим не закріплено жодного відвантаження." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {STATE_ORDER.map((state) => {
                  const meta = STATE_META[state];
                  const count = portfolio.counts[state];
                  const active = stateFilter === state;
                  return (
                    <button
                      key={state}
                      type="button"
                      onClick={() => setStateFilter(active ? "ALL" : state)}
                      aria-pressed={active}
                      className={`cursor-pointer rounded-[var(--radius-card)] border p-3 text-left transition-colors ${
                        active ? "border-g400 bg-g50" : "border-g200 bg-white hover:border-g300"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: meta.color }}
                        />
                        <span className="truncate text-xs font-medium text-g600">{meta.label}</span>
                      </span>
                      <span className="mt-1 block text-2xl font-semibold tabular-nums text-bk">{count}</span>
                      <span className="mt-0.5 block text-xs leading-tight text-g400">{meta.hint}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-g500">
                <span>
                  Усього клієнтів: <span className="font-semibold text-bk">{portfolio.totalClients}</span>
                </span>
                {portfolio.newRevenue > 0 && (
                  <span>
                    Нові принесли{" "}
                    <span className="font-semibold" style={{ color: STATUS.good.fg }}>
                      {money(portfolio.newRevenue)} ₴
                    </span>
                  </span>
                )}
                {portfolio.counts.LOST > 0 && (
                  <span>
                    За втраченими стоїть{" "}
                    <span className="font-semibold" style={{ color: STATUS.bad.fg }}>
                      {money(portfolio.lostRevenue)} ₴
                    </span>{" "}
                    обороту за період
                  </span>
                )}
                {stateFilter !== "ALL" && (
                  <button
                    type="button"
                    onClick={() => setStateFilter("ALL")}
                    className="cursor-pointer font-medium text-bk underline underline-offset-2"
                  >
                    показати всіх
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {clients.length > 0 && (
          <div className="max-h-[480px] overflow-auto border-t border-g100">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0">
                <tr className="border-b border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Клієнт</th>
                  <th className="px-4 py-2.5">Стан</th>
                  <th className="px-4 py-2.5 text-right">Без замовлень</th>
                  <th className="px-4 py-2.5 text-right">Ритм</th>
                  <th className="px-4 py-2.5 text-right">SKU</th>
                  <th className="px-4 py-2.5 text-right">Борг</th>
                  <th className="px-4 py-2.5 text-right">Оборот</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {clients.map((c) => {
                  const meta = STATE_META[c.state];
                  const alarming = c.state === "SLIPPING" || c.state === "LOST" || c.state === "DORMANT";
                  return (
                    <tr key={c.counterpartyId} className="hover:bg-g50">
                      <td className="px-4 py-2.5">
                        <span className="text-bk">{c.name}</span>
                        <span className="block text-xs text-g400">
                          останнє {formatDate(c.lastDocAt)}
                          {c.state === "NEW" && ` · перше ${formatDate(c.firstDocAt)}`}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge status={meta.status} dot>
                          {meta.label}
                        </Badge>
                      </td>
                      <td
                        className="px-4 py-2.5 text-right tabular-nums"
                        style={alarming ? { color: STATUS.bad.fg, fontWeight: 600 } : { color: "var(--color-g600)" }}
                      >
                        {num(c.daysSinceLast)} дн.
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums text-g500">
                        {c.avgIntervalDays > 0 ? `~${num(c.avgIntervalDays)} дн.` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-g600">
                        {c.skuCount > 0 ? num(c.skuCount) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                        {c.overdue > 0.01 ? (
                          <span className="font-semibold" style={{ color: STATUS.bad.fg }}>
                            {money(c.overdue)}
                          </span>
                        ) : c.receivable > 0.01 ? (
                          <span className="text-g600">{money(c.receivable)}</span>
                        ) : (
                          <span className="text-g400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-bk">
                        {money(c.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>
    </>
  );
}
