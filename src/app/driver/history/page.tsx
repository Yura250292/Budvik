"use client";

/**
 * Історія маршрутів: що було по днях.
 *
 * Три цифри в рядку зводяться вперше: скільки точок планували, скільки
 * відвідав і скільки проїхав насправді. Водієві це підтвердження роботи
 * перед розрахунком, керівникові — привід поставити питання.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

type DayItem = {
  day: string;
  trackKm: number;
  trackPoints: number;
  visits: number;
  collected: number;
  routeNumber: string | null;
  plannedStops: number;
  plannedKm: number | null;
  fuelCost: number | null;
  sheet1CKm: number | null;
};

type Resp = {
  days: number;
  items: DayItem[];
  totals: { trackKm: number; visits: number; collected: number; workDays: number };
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    weekday: "short",
  }).format(d);
}

export default function DriverHistoryPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/driver/history")
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as Resp;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не вдалося завантажити"));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div style={{ background: "#F3F4F6", minHeight: "100vh" }}>
      <header
        className="sticky top-0 z-40 px-4"
        style={{
          background: "#0A0A0A",
          color: "#fff",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)",
          paddingBottom: "14px",
        }}
      >
        <h1 style={{ fontSize: "19px", fontWeight: 700 }}>Історія маршрутів</h1>
        {data && (
          <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "3px" }}>
            {data.totals.workDays} робочих днів · {data.totals.trackKm} км ·{" "}
            {money.format(data.totals.collected)} ₴ зібрано
          </p>
        )}
      </header>

      <div className="px-4 py-4">
        {error && (
          <div className="rounded-xl p-3" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
            <p style={{ fontSize: "13px", color: "#B91C1C" }}>{error}</p>
          </div>
        )}

        {!data && !error && (
          <p style={{ fontSize: "14px", color: "#9CA3AF" }}>Завантаження…</p>
        )}

        {data && data.items.length === 0 && (
          <div
            className="rounded-2xl px-4 py-8 text-center"
            style={{ background: "#fff", border: "1px solid #E5E7EB" }}
          >
            <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}>
              Історія поки порожня
            </p>
            <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "6px", lineHeight: 1.5 }}>
              Дні зʼявляться, щойно ви попрацюєте з «Картою дня»: вона пише трек
              і зберігає відмітки візитів.
            </p>
            <Link
              href="/driver"
              className="mt-4 inline-block cursor-pointer rounded-xl px-4 py-2.5 transition-colors"
              style={{ background: "#0A0A0A", color: "#fff", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}
            >
              До сьогоднішнього маршруту
            </Link>
          </div>
        )}

        <div className="space-y-2">
          {data?.items.map((d) => (
            <div
              key={d.day}
              className="rounded-2xl px-4 py-3"
              style={{ background: "#fff", border: "1px solid #E5E7EB" }}
            >
              <div className="flex items-baseline gap-2">
                <span style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>
                  {formatDay(d.day)}
                </span>
                {d.routeNumber && (
                  <span style={{ fontSize: "12px", color: "#6B7280" }}>{d.routeNumber}</span>
                )}
                {d.collected > 0 && (
                  <span
                    style={{ marginLeft: "auto", fontSize: "15px", fontWeight: 700, color: "#16A34A" }}
                  >
                    {money.format(d.collected)} ₴
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Stat label="Відвідано" value={`${d.visits}${d.plannedStops ? ` з ${d.plannedStops}` : ""}`} />
                <Stat label="Проїхано" value={d.trackKm > 0 ? `${d.trackKm} км` : "—"} />
                {d.plannedKm != null && <Stat label="За планом" value={`${d.plannedKm} км`} />}
                {d.sheet1CKm != null && <Stat label="Лист 1С" value={`${d.sheet1CKm} км`} />}
                {d.fuelCost != null && d.fuelCost > 0 && (
                  <Stat label="Пальне" value={`${money.format(d.fuelCost)} ₴`} />
                )}
              </div>

              {d.trackKm === 0 && d.visits > 0 && (
                <p style={{ fontSize: "11.5px", color: "#D97706", marginTop: "6px" }}>
                  Треку немає — того дня «Карта дня» не була відкрита
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ fontSize: "11px", color: "#9CA3AF" }}>{label} </span>
      <span style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>{value}</span>
    </span>
  );
}
