"use client";

/**
 * Карта клієнтів водія: усі, кого він возить, з підсвіткою сьогоднішніх.
 *
 * Та сама карта, що в торгового, але портфель інший: у водія немає
 * закріплених клієнтів — його точки це ті, куди він реально їздив. І
 * задача інша: торговий шукає, до кого заїхати, водій — де саме той
 * магазин, до якого він їде вперше.
 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CLIENT_STATE, type ClientStateKey } from "@/lib/analytics/colors";
import { ClientOrderModal } from "@/app/admin/sales-analytics/components/ClientOrderModal";
import { ClientCommentsModal } from "@/app/admin/sales-analytics/components/ClientCommentsModal";
import { DriverPinModal } from "@/components/driver/DriverPinModal";
import type { SalesClientPoint } from "@/components/map/SalesClientsMap";

const SalesClientsMap = dynamic(() => import("@/components/map/SalesClientsMap"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", width: "100%", background: "#E5E7EB" }} />,
});

type DriverClient = SalesClientPoint & {
  visits: number;
  lastVisitAt: string | null;
  today: boolean;
  mine: boolean;
};

type Resp = {
  day: string;
  clients: DriverClient[];
  counts: Record<string, number>;
  todayCount: number;
  mineCount: number;
  approximateCount: number;
};

/**
 * Що показувати на карті. Раніше вибірка була жорстко «мої» — і новий
 * водій бачив рівно сьогоднішній виїзд, тобто порожню карту.
 */
type Scope = "today" | "mine" | "all";

const LEGEND: ClientStateKey[] = ["ACTIVE", "NEW", "SLIPPING", "DORMANT", "LOST"];

export default function DriverMapPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Scope>("all");
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [orderFor, setOrderFor] = useState<{ id: string; name: string; state: ClientStateKey } | null>(null);
  const [commentsFor, setCommentsFor] = useState<{ id: string; name: string } | null>(null);
  const [pinFor, setPinFor] = useState<DriverClient | null>(null);

  // Тягнемо завжди повний набір: 379 точок — одна відповідь, а перемикання
  // «сьогодні / мої / всі» після цього миттєве, без походу в мережу.
  useEffect(() => {
    let alive = true;
    fetch("/api/driver/my-map?scope=all")
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

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }, []);

  const toggle = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const visible = (data?.clients ?? [])
    .filter((c) => !hidden.has(c.state))
    .filter((c) => (scope === "today" ? c.today : scope === "mine" ? c.mine : true));

  /** Пін уточнили — правимо точку на місці, без перезавантаження всієї карти. */
  const applyPin = useCallback((id: string, lat: number, lng: number) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            clients: prev.clients.map((c) =>
              c.id === id ? { ...c, lat, lng, approximate: false } : c
            ),
            approximateCount: Math.max(0, prev.approximateCount - 1),
          }
        : prev
    );
  }, []);

  return (
    // Фіксований шар на всю висоту мінус нижнє меню водія
    <div
      className="fixed inset-x-0"
      style={{
        top: 0,
        bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))",
        background: "#F3F4F6",
      }}
    >
      <div className="absolute inset-0">
        <SalesClientsMap
          clients={visible}
          route={null}
          me={me}
          // Картки клієнта в розділі водія немає (там лише маршрути), тож
          // посилання не даємо — натомість коментарі й уточнення піна.
          extras={{ comments: true, pin: true }}
          onAction={(a) => {
            const c = data?.clients.find((x) => x.id === a.id);
            if (!c) return;
            if (a.kind === "orderCard") setOrderFor({ id: c.id, name: c.name, state: c.state });
            else if (a.kind === "comments") setCommentsFor({ id: c.id, name: c.name });
            else if (a.kind === "pin") setPinFor(c);
          }}
        />
      </div>

      {/* Шапка поверх карти */}
      <div
        className="absolute inset-x-0 top-0 z-[500] px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)",
          paddingBottom: "10px",
          background: "linear-gradient(#F3F4F6EE, #F3F4F600)",
        }}
      >
        <div className="flex items-center gap-2">
        <div
          className="min-w-0 flex-1 rounded-full px-3 py-2"
          style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.12)" }}
        >
          <p className="truncate" style={{ fontSize: "13px", fontWeight: 600, color: "#0A0A0A" }}>
            {data ? `${visible.length} клієнтів` : "Завантаження…"}
            {data && data.todayCount > 0 && (
              <span style={{ color: "#9CA3AF", fontWeight: 400 }}>
                {" "}
                · {data.todayCount} сьогодні
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={locate}
          aria-label="Де я"
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200"
          style={{
            minWidth: "40px",
            minHeight: "40px",
            background: "#fff",
            boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
            border: "none",
          }}
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke={locating ? "#9CA3AF" : "#2563EB"}
            strokeWidth={1.9}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            <circle cx="12" cy="12" r="6" />
          </svg>
        </button>
        </div>

        {/* Обсяг карти. Окремим рядом, а не в шапці: три варіанти поруч із
            лічильником не влазять у 800px портрета, і «Всі» опинялося б за
            краєм. Сегменти — 44px заввишки, у них цілять пальцем у машині. */}
        {data && (
          <div
            className="mt-2 flex gap-1 rounded-full p-1"
            style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.12)" }}
          >
            {(
              [
                { key: "today", label: "Сьогодні", n: data.todayCount },
                { key: "mine", label: "Мої", n: data.mineCount },
                { key: "all", label: "Всі", n: data.clients.length },
              ] as Array<{ key: Scope; label: string; n: number }>
            ).map((s) => {
              const on = scope === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScope(s.key)}
                  aria-pressed={on}
                  className="flex-1 cursor-pointer rounded-full transition-colors duration-200"
                  style={{
                    minHeight: "40px",
                    border: "none",
                    background: on ? "#0A0A0A" : "transparent",
                    color: on ? "#fff" : "#374151",
                    fontSize: "13px",
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {s.label}{" "}
                  <span style={{ color: on ? "rgba(255,255,255,0.65)" : "#9CA3AF", fontWeight: 400 }}>
                    {s.n}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div
          className="absolute inset-x-3 z-[500] rounded-xl p-3"
          style={{ top: "70px", background: "#FEF2F2", border: "1px solid #FECACA" }}
        >
          <p style={{ fontSize: "13px", color: "#B91C1C" }}>{error}</p>
        </div>
      )}

      {/* Нижня панель: легенда-фільтр */}
      {data && (
        <div className="absolute inset-x-0 bottom-0 z-[500] px-3 pb-3" style={{ pointerEvents: "none" }}>
          <div
            className="rounded-2xl"
            style={{
              background: "#fff",
              boxShadow: "0 -1px 12px rgba(0,0,0,0.12)",
              pointerEvents: "auto",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-2 px-4"
              style={{ background: "none", border: "none", minHeight: "48px" }}
            >
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
                Фільтр за станом
              </span>
              {data.approximateCount > 0 && (
                <span style={{ fontSize: "12px", color: "#D97706" }}>
                  {data.approximateCount} приблизних
                </span>
              )}
              <svg
                className="ml-auto h-4 w-4"
                style={{ transform: sheetOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="#9CA3AF"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </button>

            {sheetOpen && (
              <div className="px-3 pb-3">
                <div className="flex flex-wrap gap-1.5">
                  {LEGEND.map((k) => {
                    const off = hidden.has(k);
                    const n = data.counts[k] ?? 0;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggle(k)}
                        aria-pressed={!off}
                        className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 transition-colors duration-200"
                        style={{
                          minHeight: "40px",
                          border: "1px solid #E5E7EB",
                          background: off ? "#F3F4F6" : "#fff",
                          opacity: off ? 0.55 : 1,
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: "9px",
                            height: "9px",
                            borderRadius: "50%",
                            background: CLIENT_STATE[k].color,
                          }}
                        />
                        <span style={{ fontSize: "12px", color: "#0A0A0A" }}>{CLIENT_STATE[k].label}</span>
                        <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{n}</span>
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "8px", lineHeight: 1.4 }}>
                  «Мої» — куди ви вже возили, «Всі» — уся база компанії.
                  Тапніть точку: борг, що клієнт брав, коментарі. Якщо стоїте
                  біля магазину — уточніть точку, вона лишиться всім.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {orderFor && (
        <ClientOrderModal key={orderFor.id} client={orderFor} onClose={() => setOrderFor(null)} />
      )}
      {commentsFor && (
        <ClientCommentsModal
          key={commentsFor.id}
          client={commentsFor}
          onClose={() => setCommentsFor(null)}
        />
      )}
      {pinFor && (
        <DriverPinModal
          key={pinFor.id}
          client={{
            id: pinFor.id,
            name: pinFor.name,
            lat: pinFor.lat,
            lng: pinFor.lng,
            approximate: pinFor.approximate,
          }}
          onClose={() => setPinFor(null)}
          onSaved={(lat, lng) => applyPin(pinFor.id, lat, lng)}
        />
      )}
    </div>
  );
}
