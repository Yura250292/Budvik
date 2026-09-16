"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge, ColorDot } from "@/components/ui/Badge";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { StatCard, money, num } from "@/components/ui/Stat";
import { StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { useApi } from "@/components/ui/useApi";
import { CLIENT_STATE, type StatusKey } from "@/lib/analytics/colors";
import type { ClientState } from "@/lib/analytics/clients";
import type { MarketingBaseStats, UnownedClientRow } from "@/lib/outreach/admin-stats";
import { labelOf, OUTREACH_CHANNELS, OUTREACH_KINDS, OUTREACH_OUTCOMES } from "@/lib/outreach/types";

/**
 * «Робота з базою»: сплячі клієнти, пропозиції торгових і чи вони працюють.
 *
 * Числа рахує src/lib/outreach/admin-stats.ts. Тут — лише показ і одна дія:
 * закріпити нічийного сплячого за торговим. Без закріплення клієнт не
 * потрапляє ні в список дзвінків, ні у вівторкову підказку «Кому написати».
 *
 * Клієнт відкривається карткою кабінету (/sales/clients/<id>): там історія,
 * телефони, згода й пропозиції. Список контрагентів адмінки глибоких
 * посилань на картку не має.
 */

const DAY_OPTIONS = [30, 60, 90] as const;

/** Особливе значення вибору: кожному — торговому з його останньої накладної. */
const LAST_REP = "__last";

const CHIP = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
    active ? "border-bk bg-bk text-white" : "border-g200 bg-white text-g600 hover:bg-g50"
  }`;

const TH = "px-3 py-2 font-medium";
const TD = "px-3 py-2";

/** Порядок станів у таблицях: спершу ті, заради кого сторінка. */
const STATE_ORDER: ClientState[] = ["DORMANT", "LOST", "SLIPPING", "ACTIVE", "NEW"];

const OUTCOME_STATUS: Record<string, StatusKey> = {
  ORDERED: "good",
  PENDING: "info",
  REPLIED: "info",
  NO_ANSWER: "neutral",
  REFUSED: "warn",
  OPT_OUT: "bad",
};

function pct(rate: number | null | undefined): string {
  return rate == null ? "—" : `${num(rate * 100, 1)}%`;
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MarketingScreen() {
  const [days, setDays] = useState<number>(30);
  const { data, loading, error, reload } = useApi<MarketingBaseStats>(`/api/admin/marketing/base?days=${days}`);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold leading-tight text-bk">Робота з базою</h1>
        <p className="mt-0.5 text-[13px] text-g500">
          Сплячі й втрачені клієнти, пропозиції торгових і чи повертають вони людей. Торговий пише клієнту зі свого
          планшета; «замовив» ставить воркер, коли за 14 днів проходить реалізація з 1С.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-g500">Пропозиції за</span>
        {DAY_OPTIONS.map((d) => (
          <button key={d} type="button" className={CHIP(days === d)} onClick={() => setDays(d)}>
            {d} днів
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}

      {!data && loading && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <Card>
            <TableSkeleton rows={6} cols={6} />
          </Card>
        </>
      )}

      {data && (
        <>
          <Tiles data={data} />
          <BaselineCard data={data} />
          <RepsCard data={data} />
          <UnownedCard data={data} onChanged={reload} />
          <RecentCard data={data} />
        </>
      )}
    </div>
  );
}

function Tiles({ data }: { data: MarketingBaseStats }) {
  const t = data.tiles;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Клієнтів з покупками"
          value={num(t.clients)}
          hint={`сплячих ${num(t.states.DORMANT)} · втрачених ${num(t.states.LOST)}`}
        />
        <StatCard
          label="Є мобільний"
          value={num(t.withMobile)}
          unit={`з ${num(t.clients)}`}
          hint={`сплячим і втраченим можна написати: ${num(t.sleepingWithMobile)}`}
        />
        <StatCard
          label="Згода на розсилки"
          value={num(t.consent.GRANTED)}
          hint={`не писати: ${num(t.refusing)} · не питали: ${num(t.consent.UNKNOWN)}`}
        />
        <StatCard
          label={`Пропозицій за ${data.period.days} дн`}
          value={num(t.offers)}
          hint={`різним клієнтам: ${num(t.offerClients)}`}
        />
        <StatCard
          label="Замовили після пропозиції"
          value={pct(t.marketing.rate)}
          hint={
            t.marketing.closed > 0
              ? `${num(t.marketing.ordered)} з ${num(t.marketing.closed)} закритих рекламних · ${money(t.marketing.orderedAmount)} ₴ · чекаємо ${num(t.marketing.pending)}`
              : `закритих ще немає · чекаємо ${num(t.marketing.pending)}`
          }
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {STATE_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[12px] text-g600" title={CLIENT_STATE[s].hint}>
            <ColorDot color={CLIENT_STATE[s].color} />
            {CLIENT_STATE[s].label}: <b className="tabular-nums text-bk">{num(t.states[s])}</b>
          </span>
        ))}
      </div>
    </>
  );
}

function BaselineCard({ data }: { data: MarketingBaseStats }) {
  const b = data.baseline;
  const conv = data.tiles.conversionByState;
  return (
    <Card>
      <CardHeader
        title="Чи повертають пропозиції"
        hint={
          b
            ? `Без повідомлення — ${b.note}. Зрізи ${b.cuts.map(dayLabel).join(", ")}, вікно ${b.windowDays} дн; клієнтів, яким писали, прибрано (${num(b.excludedContacted)}).`
            : (data.baselineError ?? "Базова оцінка ще не порахована")
        }
      />
      <TableScroll minWidth={560}>
        <table className="w-full text-xs">
          <thead className="bg-g50">
            <tr className="border-b border-g200 text-left text-g500">
              <th className={TH}>Стан клієнта</th>
              <th className={`${TH} text-right`}>Без повідомлення купили</th>
              <th className={`${TH} text-right`}>Після пропозиції замовили</th>
            </tr>
          </thead>
          <tbody>
            {STATE_ORDER.map((s) => {
              const base = b?.byState[s];
              const c = conv[s];
              return (
                <tr key={s} className="border-b border-g100 last:border-0">
                  <td className={TD}>
                    <span className="inline-flex items-center gap-1.5">
                      <ColorDot color={CLIENT_STATE[s].color} />
                      {CLIENT_STATE[s].label}
                    </span>
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {base && base.clients > 0 ? (
                      <>
                        <b className="text-bk">{pct(base.rate)}</b>{" "}
                        <span className="text-g500">
                          ({num(base.bought)} з {num(base.clients)})
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {c.closed > 0 ? (
                      <>
                        <b className="text-bk">{pct(c.rate)}</b>{" "}
                        <span className="text-g500">
                          ({num(c.ordered)} з {num(c.closed)})
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

function RepsCard({ data }: { data: MarketingBaseStats }) {
  return (
    <Card padded={false}>
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <CardHeader
          title="Торгові"
          hint={`Закріплені сплячі й втрачені, кому писали за ${data.period.days} дн і скільки з того вийшло. Оборот під ризиком — з ${dayLabel(data.revenueSinceDay)}.`}
        />
      </div>
      {data.reps.length === 0 ? (
        <EmptyState title="Торгових немає" />
      ) : (
        <TableScroll minWidth={760}>
          <table className="w-full text-xs">
            <thead className="bg-g50">
              <tr className="border-b border-g200 text-left text-g500">
                <th className={TH}>Торговий</th>
                <th className={`${TH} text-right`}>Закріплено</th>
                <th className={`${TH} text-right`}>Сплячих</th>
                <th className={`${TH} text-right`}>Втрачених</th>
                <th className={`${TH} text-right`}>Пропозицій</th>
                <th className={`${TH} text-right`}>Клієнтам</th>
                <th className={`${TH} text-right`}>Замовили</th>
                <th className={`${TH} text-right`}>Оборот під ризиком, ₴</th>
              </tr>
            </thead>
            <tbody>
              {data.reps.map((r) => (
                <tr key={r.repId} className="border-b border-g100 last:border-0">
                  <td className={`${TD} font-medium text-bk`}>{r.name}</td>
                  <td className={`${TD} text-right tabular-nums`}>{num(r.assigned)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{num(r.dormant)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{num(r.lost)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{num(r.offers)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{num(r.contacted)}</td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {num(r.converted)}
                    {r.orderedAmount > 0 && <span className="block text-[11px] text-g500">{money(r.orderedAmount)} ₴</span>}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{money(r.revenueAtRisk)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}

function UnownedCard({ data, onChanged }: { data: MarketingBaseStats; onChanged: () => void }) {
  const { rows, total, withMobile, revenue, limit } = data.unowned;
  const salesIds = new Set(data.salesReps.map((r) => r.id));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRep, setBulkRep] = useState("");
  const [rowRep, setRowRep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /** Підказка: торговий з останньої накладної, якщо це справді торговий. */
  const suggested = (r: UnownedClientRow) => (r.lastRep && salesIds.has(r.lastRep.id) ? r.lastRep.id : "");
  const repOf = (r: UnownedClientRow) => rowRep[r.counterpartyId] ?? suggested(r);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.counterpartyId));

  async function assign(groups: Map<string, string[]>, noRep: number) {
    if (groups.size === 0) {
      setMsg({ ok: false, text: "Нікого закріпити: у вибраних немає торгового в накладних" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      let added = 0;
      for (const [repId, counterpartyIds] of groups) {
        const res = await fetch(`/api/admin/sales-reps/${repId}/clients/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ counterpartyIds }),
        });
        const d = (await res.json().catch(() => ({}))) as { added?: number; error?: string };
        if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
        added += d.added ?? 0;
      }
      setMsg({
        ok: true,
        text: `Закріплено: ${added}${noRep > 0 ? ` · без торгового в накладних пропущено: ${noRep}` : ""}`,
      });
      setSelected(new Set());
      setRowRep({});
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Не вдалося закріпити" });
    } finally {
      setBusy(false);
    }
  }

  const assignSelected = () => {
    const groups = new Map<string, string[]>();
    let noRep = 0;
    for (const r of rows) {
      if (!selected.has(r.counterpartyId)) continue;
      const rep = bulkRep === LAST_REP ? suggested(r) : bulkRep;
      if (!rep) {
        noRep++;
        continue;
      }
      groups.set(rep, [...(groups.get(rep) ?? []), r.counterpartyId]);
    }
    void assign(groups, noRep);
  };

  return (
    <Card padded={false}>
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <CardHeader
          title={`Нічийні сплячі: ${num(total)}`}
          hint={`Сплячі й втрачені, не закріплені ні за ким і без пропозиції 30 днів. З мобільним: ${num(withMobile)}. Оборот з ${dayLabel(data.revenueSinceDay)}: ${money(revenue)} ₴.${total > limit ? ` Показано перші ${limit} за оборотом.` : ""}`}
        />
        {rows.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-g600">Вибрано: {selected.size}</span>
            <select
              value={bulkRep}
              onChange={(e) => setBulkRep(e.target.value)}
              className="rounded-[var(--radius-btn)] border border-g200 bg-white px-2 py-1.5 text-[13px] text-bk"
            >
              <option value="">Закріпити за…</option>
              <option value={LAST_REP}>торговим з останньої накладної</option>
              {data.salesReps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || selected.size === 0 || !bulkRep}
              onClick={assignSelected}
              className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-3 py-1.5 text-[13px] font-semibold text-white disabled:cursor-default disabled:opacity-40"
            >
              Закріпити вибраних
            </button>
            {msg && <span className={`text-[12px] ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Нічийних сплячих немає" hint="Усі сплячі й втрачені або закріплені, або отримали пропозицію за 30 днів." />
      ) : (
        <TableScroll minWidth={980} stickyHeader>
          <table className="w-full text-xs">
            <thead className="bg-g50">
              <tr className="border-b border-g200 text-left text-g500">
                <th className={TH}>
                  <input
                    type="checkbox"
                    aria-label="Вибрати всіх"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.counterpartyId)))}
                  />
                </th>
                <th className={TH}>Клієнт</th>
                <th className={TH}>Стан</th>
                <th className={TH}>Мобільний</th>
                <th className={TH}>Остання покупка</th>
                <th className={`${TH} text-right`}>Днів</th>
                <th className={`${TH} text-right`}>Оборот, ₴</th>
                <th className={TH}>Останній торговий</th>
                <th className={TH}>Закріпити</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rep = repOf(r);
                return (
                  <tr key={r.counterpartyId} className="border-b border-g100 last:border-0">
                    <td className={TD}>
                      <input
                        type="checkbox"
                        aria-label={`Вибрати ${r.name}`}
                        checked={selected.has(r.counterpartyId)}
                        onChange={() => toggle(r.counterpartyId)}
                      />
                    </td>
                    <td className={`${TD} max-w-[260px]`}>
                      <Link href={`/sales/clients/${r.counterpartyId}`} className="font-medium text-bk hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <ColorDot color={CLIENT_STATE[r.state].color} size={8} />
                        {CLIENT_STATE[r.state].label}
                      </span>
                    </td>
                    <td className={TD}>{r.hasMobile ? "є" : <span className="text-g400">немає</span>}</td>
                    <td className={`${TD} tabular-nums`}>{dayLabel(r.lastDocDay)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{num(r.daysSinceLast)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{money(r.revenue)}</td>
                    <td className={TD}>
                      {r.lastRep ? (
                        <>
                          {r.lastRep.name}
                          {r.lastRep.role !== "SALES" && <span className="text-g500"> (не торговий)</span>}
                        </>
                      ) : (
                        <span className="text-g400">—</span>
                      )}
                    </td>
                    <td className={TD}>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={rep}
                          onChange={(e) => setRowRep((prev) => ({ ...prev, [r.counterpartyId]: e.target.value }))}
                          className="max-w-[160px] rounded-[var(--radius-btn)] border border-g200 bg-white px-1.5 py-1 text-[12px] text-bk"
                        >
                          <option value="">—</option>
                          {data.salesReps.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busy || !rep}
                          onClick={() => void assign(new Map([[rep, [r.counterpartyId]]]), 0)}
                          className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-2 py-1 text-[12px] font-semibold text-bk hover:bg-g50 disabled:cursor-default disabled:opacity-40"
                        >
                          OK
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}

function RecentCard({ data }: { data: MarketingBaseStats }) {
  return (
    <Card padded={false}>
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <CardHeader title="Останні пропозиції" hint="«авто» — результат поставив воркер за реалізацією з 1С." />
      </div>
      {data.recent.length === 0 ? (
        <EmptyState title="Пропозицій ще не було" hint="Торгові відправляють їх зі сторінки «Кому написати» в кабінеті." />
      ) : (
        <TableScroll minWidth={760}>
          <table className="w-full text-xs">
            <thead className="bg-g50">
              <tr className="border-b border-g200 text-left text-g500">
                <th className={TH}>Коли</th>
                <th className={TH}>Торговий</th>
                <th className={TH}>Клієнт</th>
                <th className={TH}>Вид</th>
                <th className={TH}>Канал</th>
                <th className={TH}>Результат</th>
                <th className={`${TH} text-right`}>Сума, ₴</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id} className="border-b border-g100 last:border-0">
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{when(r.sentAt)}</td>
                  <td className={TD}>{r.repName ?? <span className="text-g400">кампанія</span>}</td>
                  <td className={`${TD} max-w-[240px]`}>
                    <Link href={`/sales/clients/${r.counterpartyId}`} className="font-medium text-bk hover:underline">
                      {r.counterpartyName}
                    </Link>
                  </td>
                  <td className={TD}>{labelOf(OUTREACH_KINDS, r.kind)}</td>
                  <td className={TD}>{labelOf(OUTREACH_CHANNELS, r.channel)}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <Badge status={OUTCOME_STATUS[r.outcome] ?? "neutral"}>{labelOf(OUTREACH_OUTCOMES, r.outcome)}</Badge>
                    {r.outcomeBy === "WORKER" && <span className="ml-1 text-[11px] text-g500">авто</span>}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {r.outcomeAmount != null ? money(r.outcomeAmount) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}
