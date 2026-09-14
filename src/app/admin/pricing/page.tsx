"use client";

import { Fragment, useState } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { TableScroll } from "@/components/ui/TableScroll";

/**
 * Ціни вітрини.
 *
 * Роздріб строго дорожчий за опт 1С. Базова ціна — опт + націнка. Раз на
 * тиждень агент звіряє ринок і пропонує конкурентну ціну; на вітрину вона
 * потрапляє лише після затвердження тут. У кожній пропозиції видно джерело
 * оцінки і стан решти сайтів, бо сторінки бувають порожні чи без наявності.
 */

type PolicyPct = { markupPct: number; minMarkupPct: number; undercutPct: number };
type Counts = {
  inStock: number; priced: number; markup: number; approved: number; floor: number;
  retail1C: number; unitMismatch: number; withMarket: number; pending: number;
};
type BrandRow = Counts & { id: string; name: string; policy: PolicyPct | null };
type SourceRow = { source: string; rows: number; ok: number; outOfStock: number; failing: number; agent: number; lastSeen: string | null };
type AgentStats = { looked: number; withPages: number; searches: number; accepted: number; costUsd: number; lastLooked: string | null };
type CoverageRow = { tier: number; inStock: number; withMarket: number };
type Overview = {
  policy: PolicyPct; totals: Counts; sources: SourceRow[]; agent: AgentStats; brands: BrandRow[]; coverage: CoverageRow[];
};

type Evidence = {
  source: string; url: string; title: string | null; price: number; inStock: boolean | null; status: string;
  seenAt: string; checkedAt: string; foundBy: string | null; usable: boolean; chosen: boolean; note: string | null;
};
type Proposal = {
  id: string; status: string; currentPrice: number; proposedPrice: number; wholesale: number; market: number;
  marketSource: string; marketUrl: string; undercut: number; flags: string[]; evidence: Evidence[]; week: string;
  createdAt: string; decidedAt: string | null; productId: string; name: string; sku: string | null; slug: string;
  stock: number; brand: string | null; livePrice: number; decidedBy: string | null; active: boolean | null;
  /** Актуальність: 1 — продавався за 30 днів, 2 — за 90, 3 — за рік, 4 — не продавався. */
  tier: number; sales90: number; views30: number;
};
type ProposalsPayload = {
  status: string; limit: number; rows: Proposal[]; counts: Record<string, number>; tiers: Record<string, number>;
  brands: { id: string; name: string; pending: number }[];
};
type ReviewRow = {
  id: string; name: string; sku: string | null; slug: string; stock: number; brand: string | null;
  price: number; basis: string; wholesale: number | null; retail1C: number | null; approved: number | null;
};

const STATUS_TABS = [
  { id: "PENDING", title: "Нові" },
  { id: "APPROVED", title: "Затверджені" },
  { id: "REJECTED", title: "Відхилені" },
] as const;

const FLAG_LABELS: Record<string, string> = {
  market_below_floor: "ринок дешевший за підлогу",
  only_out_of_stock: "лише без наявності",
  single_source: "одне джерело",
  big_change: "зміна понад 20 %",
  price_up: "дорожчання",
};

const TIER_SHORT: Record<number, string> = { 1: "продається", 2: "за 90 днів", 3: "за рік", 4: "не продавався" };
const TIER_STYLE: Record<number, string> = {
  1: "bg-green-50 text-green-700",
  2: "bg-amber-50 text-amber-700",
  3: "bg-g100 text-g600",
  4: "bg-g100 text-g400",
};
const RELEVANCE_FILTERS = [
  { id: "30", title: "Продавались за 30 днів", tiers: [1] },
  { id: "90", title: "Продавались за 90 днів", tiers: [1, 2] },
  { id: "year", title: "Продавались за рік", tiers: [1, 2, 3] },
  { id: "dead", title: "Не продавались рік", tiers: [4] },
] as const;

const SOURCE_STATUS: Record<string, string> = {
  ok: "ціна є",
  out_of_stock: "немає в наявності",
  no_price: "сторінка без ціни",
  error: "не відкрилась",
};
const statusLabel = (s: string) => SOURCE_STATUS[s] ?? (s.startsWith("http_") ? `HTTP ${s.slice(5)}` : s);

const REVIEW_VIEWS = [
  { id: "approved_below_floor", title: "Затверджена нижча за опт", hint: "Опт зріс після затвердження — товар стоїть на підлозі" },
  { id: "unit_mismatch", title: "Перевірити одиниці", hint: "«6.МАГАЗИНИ» і опт різняться в рази, тому стоїть ціна 1С" },
] as const;

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });

const uah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("uk-UA", { maximumFractionDigits: n < 10 ? 2 : 0 })} ₴`;
const num = (n: number) => n.toLocaleString("uk-UA");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("uk-UA") : "—");

function PolicyEditor({
  value, canEdit, onSave, onReset,
}: {
  value: PolicyPct;
  canEdit: boolean;
  onSave: (v: PolicyPct) => Promise<void>;
  onReset?: () => Promise<void>;
}) {
  const [markup, setMarkup] = useState(String(value.markupPct));
  const [floor, setFloor] = useState(String(value.minMarkupPct));
  const [undercut, setUndercut] = useState(String(value.undercutPct));
  const [busy, setBusy] = useState(false);
  const m = Number(markup.replace(",", "."));
  const f = Number(floor.replace(",", "."));
  const u = Number(undercut.replace(",", "."));
  const ok = [m, f, u].every(Number.isFinite);
  const example = ok
    ? `Опт 100 ₴: базова ${Math.round(100 + m)} ₴, дешевше ${Math.ceil(100 + f)} ₴ не буде. Ринок 150 ₴ — пропозиція ${Math.floor(150 * (1 - u / 100))} ₴.`
    : "";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, v: string, set: (s: string) => void) => (
    <label className="text-sm">
      <span className="block text-g500 mb-1">{label}</span>
      <span className="relative inline-block">
        <input
          value={v}
          onChange={(e) => set(e.target.value)}
          disabled={!canEdit}
          inputMode="decimal"
          className="w-24 border border-g300 rounded-lg px-3 py-1.5 pr-7 text-sm"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-g400">%</span>
      </span>
    </label>
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      {field("Націнка на опт", markup, setMarkup)}
      {field("Підлога, вище опту", floor, setFloor)}
      {field("Дешевше за ринок на", undercut, setUndercut)}
      {canEdit && (
        <button
          disabled={busy || !ok}
          onClick={() => run(() => onSave({ markupPct: m, minMarkupPct: f, undercutPct: u }))}
          className="btn-primary px-4 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Перераховую…" : "Зберегти й перерахувати"}
        </button>
      )}
      {canEdit && onReset && (
        <button
          disabled={busy}
          onClick={() => run(onReset)}
          className="px-4 py-1.5 text-sm text-g600 border border-g300 rounded-lg hover:bg-g50 disabled:opacity-40"
        >
          Як загальне
        </button>
      )}
      <span className="text-xs text-g400 pb-2 basis-full">{example}</span>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" | "accent" }) {
  const color = tone === "warn" && value > 0 ? "text-red-600" : tone === "accent" && value > 0 ? "text-primary-dark" : "text-bk";
  return (
    <div className="bg-white border rounded-xl px-4 py-3 min-w-0">
      <div className={`text-2xl font-semibold ${color}`}>{num(value)}</div>
      <div className="text-sm text-g600">{label}</div>
      {hint && <div className="text-xs text-g400 mt-0.5">{hint}</div>}
    </div>
  );
}

function EvidenceTable({ rows }: { rows: Evidence[] }) {
  if (rows.length === 0) return <p className="text-sm text-g400">Джерел немає.</p>;
  return (
    <TableScroll minWidth={640}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-g500">
            <th className="text-left py-1 pr-3 font-medium">Сайт</th>
            <th className="text-right py-1 pr-3 font-medium">Ціна</th>
            <th className="text-left py-1 pr-3 font-medium">Стан</th>
            <th className="text-left py-1 pr-3 font-medium">Бачили</th>
            <th className="text-left py-1 font-medium">Примітка</th>
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => Number(b.chosen) - Number(a.chosen) || Number(b.usable) - Number(a.usable) || a.price - b.price)
            .map((e) => (
              <tr key={`${e.source}-${e.url}`} className={e.chosen ? "font-semibold text-bk" : e.usable ? "text-g700" : "text-g400"}>
                <td className="py-1 pr-3">
                  <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline" title={e.title ?? e.url}>
                    {e.source}
                  </a>
                  {e.foundBy === "agent" && <span className="ml-1 text-g400">· агент</span>}
                </td>
                <td className="py-1 pr-3 text-right">{uah(e.price)}</td>
                <td className="py-1 pr-3">{statusLabel(e.status)}</td>
                <td className="py-1 pr-3">{day(e.seenAt)}</td>
                <td className="py-1">{e.chosen ? "взято для пропозиції" : e.note ?? (e.usable ? "дорожче за взяте" : "")}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function ProposalsSection({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]["id"]>("PENDING");
  const [brandId, setBrandId] = useState("");
  const [flag, setFlag] = useState("");
  const [relevance, setRelevance] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const qs = new URLSearchParams({
    status,
    ...(brandId ? { brandId } : {}),
    ...(flag ? { flag } : {}),
    ...(relevance ? { relevance } : {}),
  }).toString();
  const { data, error, mutate } = useSWR<ProposalsPayload>(`/api/admin/pricing/proposals?${qs}`, fetcher);
  const rows = data?.rows ?? [];
  const pendingTab = status === "PENDING";
  const filtered = Boolean(brandId || flag || relevance);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const act = async (payload: Record<string, unknown>, label: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/pricing/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: body.error || "Не вдалося" });
        return;
      }
      const text =
        body.created !== undefined
          ? `нових ${num(body.created)}, без змін ${num((body.kept ?? 0) + (body.unchanged ?? 0))}, замінено ${num(body.superseded ?? 0)}, чекають рішення ${num(body.pendingTotal ?? 0)}`
          : `рішень ${num(body.decided ?? 0)}, змінилось цін на сайті ${num(body.priceChanged ?? 0)}`;
      setMsg({ ok: true, text: `${label}: ${text}` });
      setSelected(new Set());
      await mutate();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <section className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-bk mr-2">Пропозиції агента</h2>
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setStatus(t.id);
              setSelected(new Set());
            }}
            className={`px-3 py-1.5 rounded-full text-sm ${status === t.id ? "bg-bk text-white" : "bg-g100 text-g600 hover:bg-g200"}`}
          >
            {t.title} {data?.counts[t.id] ? `(${num(data.counts[t.id])})` : ""}
          </button>
        ))}
        <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="ml-auto border border-g300 rounded-lg px-3 py-1.5 text-sm max-w-full">
          <option value="">Усі бренди</option>
          {(data?.brands ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.pending})
            </option>
          ))}
        </select>
        <select value={relevance} onChange={(e) => setRelevance(e.target.value)} className="border border-g300 rounded-lg px-3 py-1.5 text-sm max-w-full">
          <option value="">Будь-яка актуальність</option>
          {RELEVANCE_FILTERS.map((f) => {
            const n = f.tiers.reduce((sum, t) => sum + (data?.tiers[String(t)] ?? 0), 0);
            return (
              <option key={f.id} value={f.id}>
                {f.title} ({num(n)})
              </option>
            );
          })}
        </select>
        <select value={flag} onChange={(e) => setFlag(e.target.value)} className="border border-g300 rounded-lg px-3 py-1.5 text-sm max-w-full">
          <option value="">Усі позначки</option>
          {Object.entries(FLAG_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>

      <p className="px-5 pb-3 text-xs text-g400">
        Спершу — товари, що продаються зараз: за 30 днів, потім за 90, потім решта. Пропозиція — найнижча придатна
        ринкова ціна мінус знижка, але не дешевше підлоги. «Джерела» показують усі сайти:
        звідки взято оцінку, де товару немає в наявності, де сторінка порожня чи зникла.
      </p>

      {canEdit && (
        <div className="px-5 pb-3 flex flex-wrap gap-2">
          {pendingTab && (
            <>
              <button
                disabled={busy || selected.size === 0}
                onClick={() => act({ action: "approve", ids: [...selected] }, "Затверджено")}
                className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Затвердити вибрані ({selected.size})
              </button>
              <button
                disabled={busy || selected.size === 0}
                onClick={() => act({ action: "reject", ids: [...selected] }, "Відхилено")}
                className="px-3 py-1.5 text-sm text-g600 border border-g300 rounded-lg hover:bg-g50 disabled:opacity-40"
              >
                Відхилити вибрані
              </button>
              {filtered && rows.length > 0 && (
                <button
                  disabled={busy}
                  onClick={() => act({ action: "approve", ids: rows.map((r) => r.id) }, `Затверджено показані`)}
                  className="px-3 py-1.5 text-sm text-primary-dark border border-primary/40 rounded-lg hover:bg-primary/5 disabled:opacity-40"
                >
                  Затвердити всі показані ({num(rows.length)})
                </button>
              )}
            </>
          )}
          <button
            disabled={busy}
            onClick={() => act({ action: "rebuild" }, "Пропозиції оновлено")}
            className="px-3 py-1.5 text-sm text-g600 border border-g300 rounded-lg hover:bg-g50 disabled:opacity-40 sm:ml-auto"
          >
            {busy ? "Працюю…" : "Скласти пропозиції зараз"}
          </button>
        </div>
      )}

      {msg && (
        <div className={`mx-5 mb-3 rounded-lg p-2 text-sm border ${msg.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      {error ? (
        <div className="px-5 pb-5 text-sm text-red-600">{String(error.message)}</div>
      ) : !data ? (
        <div className="px-5 pb-5 text-sm text-g400">Завантажую…</div>
      ) : rows.length === 0 ? (
        <div className="px-5 pb-5 text-sm text-g400">Пропозицій немає.</div>
      ) : (
        <TableScroll stickyHeader minWidth={980}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-g50 border-y">
                {canEdit && pendingTab && (
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    />
                  </th>
                )}
                <th className="text-left px-3 py-2 font-medium text-g600">Товар</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Продажі</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Залишок</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Опт</th>
                <th className="text-right px-3 py-2 font-medium text-g600">На сайті</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Пропозиція</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Ринок</th>
                <th className="text-left px-3 py-2 font-medium text-g600">Позначки</th>
                <th className="text-left px-3 py-2 font-medium text-g600"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.livePrice > 0 ? Math.round(((r.proposedPrice - r.livePrice) / r.livePrice) * 1000) / 10 : null;
                const cols = (canEdit && pendingTab ? 1 : 0) + 9;
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b hover:bg-g50 align-top">
                      {canEdit && pendingTab && (
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => setSelected((s) => toggle(s, r.id))} />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <a href={`/catalog/${r.slug}`} target="_blank" rel="noreferrer" className="text-bk hover:underline">
                          {r.name}
                        </a>
                        <div className="text-xs text-g400">{[r.brand, r.sku, r.week].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${TIER_STYLE[r.tier] ?? TIER_STYLE[4]}`}>
                          {TIER_SHORT[r.tier] ?? TIER_SHORT[4]}
                        </span>
                        <div className="text-xs text-g400 mt-0.5">
                          {r.sales90 ? `${num(r.sales90)} за 90 дн` : "—"}
                          {r.views30 ? ` · ${num(r.views30)} перегл.` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">{num(r.stock)}</td>
                      <td className="px-3 py-2 text-right">{uah(r.wholesale)}</td>
                      <td className="px-3 py-2 text-right">{uah(r.livePrice)}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {uah(r.proposedPrice)}
                        {diff !== null && (
                          <div className={`text-xs font-normal ${diff > 0 ? "text-amber-700" : "text-green-700"}`}>
                            {diff > 0 ? "+" : ""}
                            {diff} %
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a href={r.marketUrl} target="_blank" rel="noreferrer" className="text-primary-dark hover:underline">
                          {uah(r.market)}
                        </a>
                        <div className="text-xs text-g400">{r.marketSource}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.flags.map((f) => (
                            <span
                              key={f}
                              className={`text-xs px-2 py-0.5 rounded-full ${f === "market_below_floor" ? "bg-red-50 text-red-700" : "bg-g100 text-g600"}`}
                            >
                              {FLAG_LABELS[f] ?? f}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button onClick={() => setOpen((s) => toggle(s, r.id))} className="text-sm text-g600 hover:underline">
                          Джерела ({r.evidence.length})
                        </button>
                        {!pendingTab && (
                          <div className="text-xs text-g400 mt-1">
                            {r.decidedBy ?? ""} {day(r.decidedAt)}
                          </div>
                        )}
                        {status === "APPROVED" && r.active && canEdit && (
                          <button
                            disabled={busy}
                            onClick={() => act({ action: "revert", productIds: [r.productId] }, "Знято затверджену ціну")}
                            className="block mt-1 text-xs text-red-600 hover:underline disabled:opacity-40"
                          >
                            Зняти, повернути опт + націнку
                          </button>
                        )}
                      </td>
                    </tr>
                    {open.has(r.id) && (
                      <tr className="border-b bg-g50">
                        <td colSpan={cols} className="px-5 py-3">
                          <EvidenceTable rows={r.evidence} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
      {data && rows.length >= data.limit && (
        <p className="px-5 py-2 text-xs text-g400">Показано перші {data.limit}. Звузьте брендом або позначкою.</p>
      )}
    </section>
  );
}

function ReviewLists() {
  const [view, setView] = useState<(typeof REVIEW_VIEWS)[number]["id"]>("approved_below_floor");
  const { data } = useSWR<{ rows: ReviewRow[] }>(`/api/admin/pricing/products?view=${view}`, fetcher);
  const hint = REVIEW_VIEWS.find((v) => v.id === view)!.hint;
  return (
    <section className="bg-white border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-2">
        {REVIEW_VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`px-3 py-1.5 rounded-full text-sm ${view === v.id ? "bg-bk text-white" : "bg-g100 text-g600 hover:bg-g200"}`}
          >
            {v.title}
          </button>
        ))}
      </div>
      <p className="px-5 pb-3 text-xs text-g400">{hint}. Лише товари в наявності.</p>
      {!data ? (
        <div className="px-5 pb-5 text-sm text-g400">Завантажую…</div>
      ) : data.rows.length === 0 ? (
        <div className="px-5 pb-5 text-sm text-g400">Таких товарів немає.</div>
      ) : (
        <TableScroll stickyHeader minWidth={720}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-g50 border-y">
                <th className="text-left px-5 py-2 font-medium text-g600">Товар</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Залишок</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Опт 1С</th>
                <th className="text-right px-3 py-2 font-medium text-g600">{view === "unit_mismatch" ? "6.МАГАЗИНИ" : "Затверджено"}</th>
                <th className="text-right px-5 py-2 font-medium text-g600">На сайті</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-g50">
                  <td className="px-5 py-2">
                    <a href={`/catalog/${r.slug}`} target="_blank" rel="noreferrer" className="text-bk hover:underline">{r.name}</a>
                    <div className="text-xs text-g400">{[r.brand, r.sku].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{num(r.stock)}</td>
                  <td className="px-3 py-2 text-right">{uah(r.wholesale)}</td>
                  <td className="px-3 py-2 text-right">{uah(view === "unit_mismatch" ? r.retail1C : r.approved)}</td>
                  <td className="px-5 py-2 text-right font-medium">{uah(r.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </section>
  );
}

export default function PricingPage() {
  const { data: session } = useSession();
  const canEdit = (session?.user as { role?: string } | undefined)?.role === "ADMIN";
  const { data, error, mutate } = useSWR<Overview>("/api/admin/pricing", fetcher);
  const [openBrand, setOpenBrand] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [fail, setFail] = useState("");

  const patch = async (payload: Record<string, unknown>, label: string) => {
    setNotice("");
    setFail("");
    const res = await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFail(body.error || "Не вдалося зберегти");
      return;
    }
    setNotice(`${label}: перераховано ${num(body.evaluated ?? 0)} товарів, змінилось цін — ${num(body.priceChanged ?? 0)}`);
    await mutate();
  };

  if (error) return <div className="p-6 text-red-600">{String(error.message)}</div>;
  if (!data) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-g200 rounded" />)}
      </div>
    );
  }

  const t = data.totals;
  const a = data.agent;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-bk">Ціни вітрини</h1>
        <p className="text-sm text-g500 mt-1 max-w-3xl">
          Роздріб завжди строго дорожчий за опт з 1С. Базова ціна — опт + націнка. Раз на тиждень агент звіряє ціни в
          інтернет-магазинах і пропонує стати трохи дешевше за ринок; на сайт пропозиція потрапляє лише після затвердження.
        </p>
      </div>

      {fail && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 text-sm">{fail}</div>}
      {notice && <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-2 text-sm">{notice}</div>}

      <section className="bg-white border rounded-xl p-5">
        <h2 className="font-semibold text-bk mb-3">Загальне правило</h2>
        <PolicyEditor
          key={JSON.stringify(data.policy)}
          value={data.policy}
          canEdit={canEdit}
          onSave={(v) => patch({ brandId: null, ...v }, "Загальне правило")}
        />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="У наявності з ціною" value={t.priced} hint={`з ${num(t.inStock)} у наявності`} />
        <Tile label="Опт + націнка" value={t.markup} />
        <Tile label="Затверджені" value={t.approved} />
        <Tile label="Чекають рішення" value={t.pending} tone="accent" />
        <Tile label="Затверджена нижча за опт" value={t.floor} hint="стоять на підлозі" tone="warn" />
        <Tile label="Ціна 1С" value={t.retail1C} hint={`з них одиниці: ${num(t.unitMismatch)}`} />
      </section>

      <ProposalsSection canEdit={canEdit} onChanged={() => void mutate()} />

      <section className="bg-white border rounded-xl overflow-hidden">
        <h2 className="font-semibold text-bk px-5 pt-4 pb-1">Звідки ринкові ціни</h2>
        <p className="px-5 pb-3 text-xs text-g400">
          Ринкова ціна є для {num(t.withMarket)} із {num(t.inStock)} товарів у наявності. Агент шукав сторінки для {num(a.looked)} товарів,
          знайшов для {num(a.withPages)}; пошуків {num(a.searches)}, орієнтовно ${a.costUsd}
          {a.lastLooked ? `, востаннє ${day(a.lastLooked)}` : ""}.
        </p>
        {data.coverage.length > 0 && (
          <p className="px-5 pb-3 text-xs text-g500">
            Покриття за актуальністю:{" "}
            {data.coverage
              .map((c) => `${TIER_SHORT[c.tier] ?? TIER_SHORT[4]} — ${num(c.withMarket)} з ${num(c.inStock)}`)
              .join("; ")}
            . Агент шукає спершу ті, що продаються.
          </p>
        )}
        {data.sources.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-g400">Ринкових цін ще немає.</p>
        ) : (
          <TableScroll minWidth={640}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-g50 border-y">
                  <th className="text-left px-5 py-2 font-medium text-g600">Сайт</th>
                  <th className="text-right px-3 py-2 font-medium text-g600">Сторінок</th>
                  <th className="text-right px-3 py-2 font-medium text-g600">З ціною</th>
                  <th className="text-right px-3 py-2 font-medium text-g600">Без наявності</th>
                  <th className="text-right px-3 py-2 font-medium text-g600">Порожні / зникли</th>
                  <th className="text-right px-3 py-2 font-medium text-g600">Знайшов агент</th>
                  <th className="text-right px-5 py-2 font-medium text-g600">Остання ціна</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.source} className="border-b last:border-0">
                    <td className="px-5 py-2 text-bk">{s.source}</td>
                    <td className="px-3 py-2 text-right">{num(s.rows)}</td>
                    <td className="px-3 py-2 text-right">{num(s.ok)}</td>
                    <td className="px-3 py-2 text-right">{s.outOfStock ? num(s.outOfStock) : "—"}</td>
                    <td className={`px-3 py-2 text-right ${s.failing ? "text-amber-700" : ""}`}>{s.failing ? num(s.failing) : "—"}</td>
                    <td className="px-3 py-2 text-right">{s.agent ? num(s.agent) : "—"}</td>
                    <td className="px-5 py-2 text-right text-g500">{day(s.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>

      <section className="bg-white border rounded-xl overflow-hidden">
        <h2 className="font-semibold text-bk px-5 pt-4 pb-2">Бренди</h2>
        <TableScroll stickyHeader minWidth={760}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-g50 border-y">
                <th className="text-left px-5 py-2 font-medium text-g600">Бренд</th>
                <th className="text-right px-3 py-2 font-medium text-g600">У наявності</th>
                <th className="text-right px-3 py-2 font-medium text-g600">З ринком</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Затверджені</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Чекають</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Одиниці</th>
                <th className="text-left px-5 py-2 font-medium text-g600">Правило</th>
              </tr>
            </thead>
            <tbody>
              {data.brands.map((b) => (
                <Fragment key={b.id}>
                  <tr className="border-b hover:bg-g50">
                    <td className="px-5 py-2 font-medium text-bk">{b.name}</td>
                    <td className="px-3 py-2 text-right">{num(b.inStock)}</td>
                    <td className="px-3 py-2 text-right">{b.withMarket ? num(b.withMarket) : "—"}</td>
                    <td className="px-3 py-2 text-right">{b.approved ? num(b.approved) : "—"}</td>
                    <td className={`px-3 py-2 text-right ${b.pending ? "text-primary-dark font-medium" : ""}`}>{b.pending ? num(b.pending) : "—"}</td>
                    <td className={`px-3 py-2 text-right ${b.unitMismatch ? "text-amber-700" : ""}`}>{b.unitMismatch ? num(b.unitMismatch) : "—"}</td>
                    <td className="px-5 py-2">
                      <button
                        onClick={() => setOpenBrand(openBrand === b.id ? null : b.id)}
                        className={`text-sm ${b.policy ? "text-primary-dark font-medium" : "text-g500"} hover:underline`}
                      >
                        {b.policy
                          ? `+${b.policy.markupPct} %, підлога +${b.policy.minMarkupPct} %, ринок −${b.policy.undercutPct} %`
                          : "загальне"}
                      </button>
                    </td>
                  </tr>
                  {openBrand === b.id && (
                    <tr className="border-b bg-g50">
                      <td colSpan={7} className="px-5 py-3">
                        <PolicyEditor
                          key={JSON.stringify(b.policy ?? data.policy)}
                          value={b.policy ?? data.policy}
                          canEdit={canEdit}
                          onSave={(v) => patch({ brandId: b.id, ...v }, b.name)}
                          onReset={b.policy ? () => patch({ brandId: b.id, reset: true }, b.name) : undefined}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </section>

      <ReviewLists />
    </div>
  );
}
