"use client";

import { Fragment, useState } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { TableScroll } from "@/components/ui/TableScroll";

/**
 * Ціни вітрини.
 *
 * Ціну на сайті рахує рушій (docs/pricing.md): опт 1С × націнка, але не
 * дорожче сайту виробника і не нижче підлоги. Тут — правила (загальне й по
 * брендах), розклад цін за походженням і списки товарів, на які варто
 * подивитись людині.
 */

type PolicyPct = { markupPct: number; minMarkupPct: number; followMarket: boolean };
type Counts = {
  inStock: number; priced: number; markup: number; market: number; floor: number;
  retail1C: number; withMarket: number; unitMismatch: number; marketRoom: number;
};
type BrandRow = Counts & { id: string; name: string; policy: PolicyPct | null };
type Overview = {
  policy: PolicyPct;
  freshDays: number;
  totals: Counts;
  sources: { source: string; rows: number; fresh: number; lastSeen: string | null }[];
  brands: BrandRow[];
};
type ProductRow = {
  id: string; name: string; sku: string | null; slug: string; stock: number; brand: string | null;
  price: number; basis: string; wholesale: number | null; retail1C: number | null;
  market: number | null; marketSource: string | null; marketUrl: string | null; flags: string[];
};

const VIEWS = [
  { id: "above_market", title: "Дорожчі за ринок", hint: "Навіть на підлозі ціна вища, ніж на сайті виробника" },
  { id: "unit_mismatch", title: "Перевірити одиниці", hint: "«6.МАГАЗИНИ» і опт різняться в рази, тому стоїть ціна 1С" },
  { id: "market", title: "Опущені до ринку", hint: "Ціна нижча за націнку, бо виробник продає дешевше" },
  { id: "market_room", title: "Запас до ринку", hint: "Виробник продає дорожче більш ніж на 10 %" },
] as const;

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });

const uah = (n: number | null) =>
  n === null ? "—" : `${n.toLocaleString("uk-UA", { maximumFractionDigits: n < 10 ? 2 : 0 })} ₴`;
const num = (n: number) => n.toLocaleString("uk-UA");

function PolicyEditor({
  value,
  canEdit,
  onSave,
  onReset,
}: {
  value: PolicyPct;
  canEdit: boolean;
  onSave: (v: PolicyPct) => Promise<void>;
  onReset?: () => Promise<void>;
}) {
  const [markup, setMarkup] = useState(String(value.markupPct));
  const [floor, setFloor] = useState(String(value.minMarkupPct));
  const [follow, setFollow] = useState(value.followMarket);
  const [busy, setBusy] = useState(false);
  const m = Number(markup.replace(",", "."));
  const f = Number(floor.replace(",", "."));
  const example = Number.isFinite(m) && Number.isFinite(f)
    ? `опт 100 ₴ → ${Math.round(100 + m)} ₴, до ринку не нижче ${Math.ceil(100 + f)} ₴`
    : "";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="block text-g500 mb-1">Націнка на опт</span>
        <span className="relative inline-block">
          <input
            value={markup}
            onChange={(e) => setMarkup(e.target.value)}
            disabled={!canEdit}
            inputMode="decimal"
            className="w-24 border border-g300 rounded-lg px-3 py-1.5 pr-7 text-sm"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-g400">%</span>
        </span>
      </label>
      <label className="text-sm">
        <span className="block text-g500 mb-1">Підлога</span>
        <span className="relative inline-block">
          <input
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            disabled={!canEdit}
            inputMode="decimal"
            className="w-24 border border-g300 rounded-lg px-3 py-1.5 pr-7 text-sm"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-g400">%</span>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm pb-2">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} disabled={!canEdit} />
        Опускати до ціни виробника
      </label>
      {canEdit && (
        <button
          disabled={busy}
          onClick={() => run(() => onSave({ markupPct: m, minMarkupPct: f, followMarket: follow }))}
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
      <span className="text-xs text-g400 pb-2 basis-full sm:basis-auto">{example}</span>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "warn" }) {
  return (
    <div className="bg-white border rounded-xl px-4 py-3 min-w-0">
      <div className={`text-2xl font-semibold ${tone === "warn" && value > 0 ? "text-red-600" : "text-bk"}`}>{num(value)}</div>
      <div className="text-sm text-g600">{label}</div>
      {hint && <div className="text-xs text-g400 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function PricingPage() {
  const { data: session } = useSession();
  const canEdit = (session?.user as { role?: string } | undefined)?.role === "ADMIN";
  const { data, error, mutate } = useSWR<Overview>("/api/admin/pricing", fetcher);
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("above_market");
  const [brandFilter, setBrandFilter] = useState("");
  const [openBrand, setOpenBrand] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [fail, setFail] = useState("");
  const { data: list, mutate: mutateList } = useSWR<{ rows: ProductRow[]; limit: number }>(
    `/api/admin/pricing/products?view=${view}${brandFilter ? `&brandId=${brandFilter}` : ""}`,
    fetcher
  );

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
    await Promise.all([mutate(), mutateList()]);
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
  const currentView = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-bk">Ціни вітрини</h1>
        <p className="text-sm text-g500 mt-1 max-w-3xl">
          Ціна на сайті = опт з 1С + націнка. Якщо на сайті виробника товар дешевший, ціна опускається до ринкової,
          але не нижче підлоги. Дорожчий ринок ціну не піднімає. Ринкові ціни воркер переперевіряє щотижня вночі.
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
        <Tile label="Опущені до ринку" value={t.market} />
        <Tile label="Дорожчі за ринок" value={t.floor} hint="стоять на підлозі" tone="warn" />
        <Tile label="Ціна 1С" value={t.retail1C} hint={`з них одиниці: ${num(t.unitMismatch)}`} />
        <Tile label="Звірено з ринком" value={t.withMarket} hint={`свіжіше ${data.freshDays} днів`} />
      </section>

      <section className="bg-white border rounded-xl overflow-hidden">
        <h2 className="font-semibold text-bk px-5 pt-4 pb-2">Сайти, з якими звіряємо</h2>
        {data.sources.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-g400">Ринкових цін ще немає.</p>
        ) : (
          <TableScroll minWidth={480}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-g50 border-y">
                  <th className="text-left px-5 py-2 font-medium text-g600">Сайт</th>
                  <th className="text-right px-5 py-2 font-medium text-g600">Товарів</th>
                  <th className="text-right px-5 py-2 font-medium text-g600">Свіжих</th>
                  <th className="text-right px-5 py-2 font-medium text-g600">Остання ціна</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.source} className="border-b last:border-0">
                    <td className="px-5 py-2 text-bk">{s.source}</td>
                    <td className="px-5 py-2 text-right">{num(s.rows)}</td>
                    <td className="px-5 py-2 text-right">{num(s.fresh)}</td>
                    <td className="px-5 py-2 text-right text-g500">
                      {s.lastSeen ? new Date(s.lastSeen).toLocaleDateString("uk-UA") : "—"}
                    </td>
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
                <th className="text-right px-3 py-2 font-medium text-g600">До ринку</th>
                <th className="text-right px-3 py-2 font-medium text-g600">Дорожчі</th>
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
                    <td className="px-3 py-2 text-right">{b.market ? num(b.market) : "—"}</td>
                    <td className={`px-3 py-2 text-right ${b.floor ? "text-red-600 font-medium" : ""}`}>{b.floor ? num(b.floor) : "—"}</td>
                    <td className={`px-3 py-2 text-right ${b.unitMismatch ? "text-amber-700" : ""}`}>{b.unitMismatch ? num(b.unitMismatch) : "—"}</td>
                    <td className="px-5 py-2">
                      <button
                        onClick={() => setOpenBrand(openBrand === b.id ? null : b.id)}
                        className={`text-sm ${b.policy ? "text-primary-dark font-medium" : "text-g500"} hover:underline`}
                      >
                        {b.policy
                          ? `+${b.policy.markupPct} % / підлога +${b.policy.minMarkupPct} %${b.policy.followMarket ? "" : ", без ринку"}`
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

      <section className="bg-white border rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1.5 rounded-full text-sm ${view === v.id ? "bg-bk text-white" : "bg-g100 text-g600 hover:bg-g200"}`}
            >
              {v.title}
            </button>
          ))}
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="ml-auto border border-g300 rounded-lg px-3 py-1.5 text-sm max-w-full"
          >
            <option value="">Усі бренди</option>
            {data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <p className="px-5 pb-3 text-xs text-g400">{currentView.hint}. Лише товари в наявності, спершу найбільший залишок у гривнях.</p>
        {!list ? (
          <div className="px-5 pb-5 text-sm text-g400">Завантажую…</div>
        ) : list.rows.length === 0 ? (
          <div className="px-5 pb-5 text-sm text-g400">Таких товарів немає.</div>
        ) : (
          <TableScroll stickyHeader minWidth={820}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-g50 border-y">
                  <th className="text-left px-5 py-2 font-medium text-g600">Товар</th>
                  <th className="text-right px-3 py-2 font-medium text-g600">Залишок</th>
                  <th className="text-right px-3 py-2 font-medium text-g600">Опт 1С</th>
                  {view === "unit_mismatch" && <th className="text-right px-3 py-2 font-medium text-g600">6.МАГАЗИНИ</th>}
                  <th className="text-right px-3 py-2 font-medium text-g600">На сайті</th>
                  {view !== "unit_mismatch" && <th className="text-right px-3 py-2 font-medium text-g600">Ринок</th>}
                  {view !== "unit_mismatch" && <th className="text-right px-5 py-2 font-medium text-g600">Різниця</th>}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => {
                  const diff = r.market ? Math.round(((r.price - r.market) / r.market) * 100) : null;
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-g50">
                      <td className="px-5 py-2">
                        <a href={`/catalog/${r.slug}`} target="_blank" rel="noreferrer" className="text-bk hover:underline">
                          {r.name}
                        </a>
                        <div className="text-xs text-g400">{[r.brand, r.sku].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="px-3 py-2 text-right">{num(r.stock)}</td>
                      <td className="px-3 py-2 text-right">{uah(r.wholesale)}</td>
                      {view === "unit_mismatch" && <td className="px-3 py-2 text-right">{uah(r.retail1C)}</td>}
                      <td className="px-3 py-2 text-right font-medium">{uah(r.price)}</td>
                      {view !== "unit_mismatch" && (
                        <td className="px-3 py-2 text-right">
                          {r.marketUrl ? (
                            <a href={r.marketUrl} target="_blank" rel="noreferrer" className="text-primary-dark hover:underline" title={r.marketSource ?? ""}>
                              {uah(r.market)}
                            </a>
                          ) : uah(r.market)}
                        </td>
                      )}
                      {view !== "unit_mismatch" && (
                        <td className={`px-5 py-2 text-right ${diff !== null && diff > 0 ? "text-red-600" : "text-green-700"}`}>
                          {diff === null ? "—" : `${diff > 0 ? "+" : ""}${diff} %`}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
    </div>
  );
}
