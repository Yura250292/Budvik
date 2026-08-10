"use client";

/**
 * Аналітика продажів із 1С.
 *
 * Свідомо без графічних бібліотек: стовпчики намальовані div-ами. Сторінка
 * читається на телефоні торгового так само, як на моніторі керівника, і не
 * тягне за собою 200 КБ залежностей заради семи діаграм.
 *
 * Усі цифри приходять готовими з /api/admin/sales-analytics — рахує SQL.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type RepRow = { id: string; name: string; docs: number; amount: number };
type BrandRow = { brand: string; qty: number; amount: number; docs: number };
type DayRow = { day: string; docs: number; amount: number };
type ProductRow = { name: string; sku: string; qty: number; amount: number };
type ClientRow = { name: string; docs: number; amount: number };

type Data = {
  period: { days: number; from: string };
  scope: "all" | "single" | "own";
  totals: { docs: number; amount: number; average: number };
  byRep: RepRow[];
  byBrand: BrandRow[];
  timeline: DayRow[];
  topProducts: ProductRow[];
  topClients: ClientRow[];
};

const CARD: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  border: "1px solid #E5E7EB",
  padding: 20,
};

const PERIODS = [
  { days: 7, label: "7 днів" },
  { days: 30, label: "30 днів" },
  { days: 90, label: "90 днів" },
  { days: 365, label: "Рік" },
];

/** Гривні без копійок: у звітах копійки лише заважають читати. */
function money(v: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(Math.round(v));
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(1, (value / max) * 100) : 0;
  return (
    <div style={{ background: "#F3F4F6", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
    </div>
  );
}

export default function SalesAnalyticsPage() {
  const { data: session } = useSession();
  const [days, setDays] = useState(30);
  const [rep, setRep] = useState<string>("");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (rep) params.set("rep", rep);
      const res = await fetch(`/api/admin/sales-analytics?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Помилка ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days, rep]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxRepAmount = useMemo(
    () => Math.max(1, ...(data?.byRep ?? []).map((r) => r.amount)),
    [data]
  );
  const maxBrandAmount = useMemo(
    () => Math.max(1, ...(data?.byBrand ?? []).map((b) => b.amount)),
    [data]
  );
  const maxDayAmount = useMemo(
    () => Math.max(1, ...(data?.timeline ?? []).map((d) => d.amount)),
    [data]
  );

  if (!session) {
    return <div style={{ padding: 40 }}>Потрібен вхід.</div>;
  }

  return (
    <div style={{ padding: "24px 20px", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Аналітика продажів</h1>
      <p style={{ color: "#6B7280", fontSize: 14, marginBottom: 20 }}>
        Проведені замовлення з 1С
        {data?.scope === "own" && " · лише ваші продажі"}
      </p>

      {/* --- фільтри --- */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {PERIODS.map((p) => (
          <button
            key={p.days}
            onClick={() => setDays(p.days)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid " + (days === p.days ? "#2563EB" : "#E5E7EB"),
              background: days === p.days ? "#2563EB" : "white",
              color: days === p.days ? "white" : "#374151",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}

        {data && data.scope !== "own" && data.byRep.length > 0 && (
          <select
            value={rep}
            onChange={(e) => setRep(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #E5E7EB",
              marginLeft: "auto",
            }}
          >
            <option value="">Усі торгові</option>
            {data.byRep.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div style={{ ...CARD, borderColor: "#FCA5A5", background: "#FEF2F2", color: "#B91C1C" }}>
          {error}
        </div>
      )}

      {loading && !data && <div style={{ ...CARD }}>Завантаження…</div>}

      {data && (
        <>
          {/* --- підсумки --- */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div style={CARD}>
              <div style={{ color: "#6B7280", fontSize: 13 }}>Сума продажів</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{money(data.totals.amount)} ₴</div>
            </div>
            <div style={CARD}>
              <div style={{ color: "#6B7280", fontSize: 13 }}>Замовлень</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{data.totals.docs}</div>
            </div>
            <div style={CARD}>
              <div style={{ color: "#6B7280", fontSize: 13 }}>Середній чек</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{money(data.totals.average)} ₴</div>
            </div>
          </div>

          {/* --- динаміка --- */}
          {data.timeline.length > 1 && (
            <div style={{ ...CARD, marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Динаміка</h2>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 2,
                  height: 120,
                  overflowX: "auto",
                }}
              >
                {data.timeline.map((d) => (
                  <div
                    key={d.day}
                    title={`${d.day}: ${money(d.amount)} ₴ (${d.docs} зам.)`}
                    style={{
                      flex: "1 0 6px",
                      minWidth: 6,
                      height: `${Math.max(2, (d.amount / maxDayAmount) * 100)}%`,
                      background: "#2563EB",
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "#9CA3AF",
                  marginTop: 8,
                }}
              >
                <span>{data.timeline[0]?.day}</span>
                <span>{data.timeline[data.timeline.length - 1]?.day}</span>
              </div>
            </div>
          )}

          {/* --- торгові --- */}
          {data.byRep.length > 0 && (
            <div style={{ ...CARD, marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
                Торгові
              </h2>
              {data.byRep.map((r) => (
                <div key={r.id} style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 14,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                    <span style={{ color: "#6B7280" }}>
                      {money(r.amount)} ₴ · {r.docs} зам.
                    </span>
                  </div>
                  <Bar value={r.amount} max={maxRepAmount} color="#2563EB" />
                </div>
              ))}
            </div>
          )}

          {/* --- бренди --- */}
          {data.byBrand.length > 0 && (
            <div style={{ ...CARD, marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Бренди</h2>
              {data.byBrand.map((b) => (
                <div key={b.brand} style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 14,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{b.brand}</span>
                    <span style={{ color: "#6B7280" }}>
                      {money(b.amount)} ₴ · {Math.round(b.qty)} шт
                    </span>
                  </div>
                  <Bar
                    value={b.amount}
                    max={maxBrandAmount}
                    color={b.brand === "Без бренду" ? "#9CA3AF" : "#16A34A"}
                  />
                </div>
              ))}
            </div>
          )}

          {/* --- топи --- */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 20,
            }}
          >
            <div style={CARD}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Топ товарів</h2>
              {data.topProducts.map((p, i) => (
                <div
                  key={p.sku + i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 0",
                    borderBottom: i < data.topProducts.length - 1 ? "1px solid #F3F4F6" : "none",
                    fontSize: 14,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </span>
                  <span style={{ color: "#6B7280", whiteSpace: "nowrap" }}>
                    {money(p.amount)} ₴
                  </span>
                </div>
              ))}
            </div>

            <div style={CARD}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Топ клієнтів</h2>
              {data.topClients.map((c, i) => (
                <div
                  key={c.name + i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 0",
                    borderBottom: i < data.topClients.length - 1 ? "1px solid #F3F4F6" : "none",
                    fontSize: 14,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </span>
                  <span style={{ color: "#6B7280", whiteSpace: "nowrap" }}>
                    {money(c.amount)} ₴
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
