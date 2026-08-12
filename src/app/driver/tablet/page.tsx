"use client";

/**
 * Планшет у машині: карта дня + чек-ліст клієнтів + запис треку.
 *
 * Головний екран водія на весь день. Планшет стоїть у тримачі, вкладка
 * не згортається — саме тому тут (а не в боті) збирається трек.
 *
 * Верстка розходиться за орієнтацією: на альбомній карта і список поруч
 * (у машині планшет майже завжди лежить горизонтально), на портретній
 * список стає нижньою панеллю. Кнопки великі: у них цілять пальцем, іноді
 * на ходу.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTrackRecorder } from "@/hooks/useTrackRecorder";
import type { TabletStop } from "@/components/map/TabletDayMap";

const TabletDayMap = dynamic(() => import("@/components/map/TabletDayMap"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", width: "100%", background: "#E5E7EB" }} />,
});

type DayResp = {
  day: string;
  role: string;
  route: {
    source: "ROUTE_SHEET" | "DELIVERY_ROUTE" | "NONE";
    number: string | null;
    vehicle: string | null;
    plannedKm: number | null;
    stops: TabletStop[];
  };
  progress: {
    total: number;
    done: number;
    missed: number;
    left: number;
    collected: number;
    debtPlanned: number;
  };
  track: {
    distanceKm: number;
    pointsCount: number;
    lastPointAt: string | null;
    path: Array<[number, number]>;
  };
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Що показує індикатор треку в шапці. */
const TRACK_BADGE: Record<string, { dot: string; label: string }> = {
  live: { dot: "#16A34A", label: "Трек іде" },
  buffering: { dot: "#D97706", label: "Немає звʼязку" },
  denied: { dot: "#DC2626", label: "Немає доступу до GPS" },
  unsupported: { dot: "#DC2626", label: "GPS недоступний" },
  idle: { dot: "#9CA3AF", label: "Трек вимкнено" },
};

export default function DriverTabletPage() {
  const [data, setData] = useState<DayResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const track = useTrackRecorder({ enabled: true });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tablet/day");
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setData(json as DayResp);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити день");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Трек на карті — це збережене з сервера плюс те, що набралося вже в
   * цій сесії. Інакше лінія «наздоганяла» б водія лише після
   * перезавантаження сторінки.
   */
  const fullTrail = useMemo(
    () => [...(data?.track.path ?? []), ...track.trail],
    [data?.track.path, track.trail]
  );

  const mark = useCallback(
    async (
      stop: TabletStop,
      status: "DONE" | "MISSED",
      money_: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE",
      extra?: { collectedAmount?: number; comment?: string }
    ) => {
      if (!stop.counterpartyId) return;
      setSaving(stop.key);
      try {
        const res = await fetch("/api/visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            counterpartyId: stop.counterpartyId,
            status,
            money: money_,
            debtAmount: stop.debtAmount,
            collectedAmount: extra?.collectedAmount,
            comment: extra?.comment,
            routeSheetStopId: stop.key.startsWith("rs:") ? stop.key.slice(3) : null,
            deliveryStopId: stop.key.startsWith("ds:") ? stop.key.slice(3) : null,
            // Де стоїть планшет у мить відмітки — доказ присутності
            lat: track.position?.lat ?? null,
            lng: track.position?.lng ?? null,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? "Не вдалося зберегти");
        }
        await load();
        setOpenStop(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося зберегти відмітку");
      } finally {
        setSaving(null);
      }
    },
    [load, track.position]
  );

  const badge = TRACK_BADGE[track.status] ?? TRACK_BADGE.idle;
  const stops = data?.route.stops ?? [];

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "#F3F4F6", overscrollBehavior: "none" }}
    >
      {/* Шапка: маршрут, прогрес, стан треку */}
      <header
        className="flex shrink-0 items-center gap-3 px-4"
        style={{
          height: "52px",
          background: "#0A0A0A",
          color: "#fff",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <span style={{ fontSize: "15px", fontWeight: 700 }}>
          {data?.route.number ? `Лист ${data.route.number}` : "Маршрут на сьогодні"}
        </span>
        {data && data.progress.total > 0 && (
          <span style={{ fontSize: "13px", color: "#9CA3AF" }}>
            {data.progress.done + data.progress.missed} з {data.progress.total}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span style={{ fontSize: "13px", color: "#9CA3AF" }}>
            {track.distanceKm || data?.track.distanceKm || 0} км
          </span>
          <span className="flex items-center gap-1.5" style={{ fontSize: "12px" }}>
            <span
              aria-hidden
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: badge.dot,
                display: "inline-block",
              }}
            />
            <span style={{ color: "#D1D5DB" }}>{badge.label}</span>
            {track.pending > 0 && (
              <span style={{ color: "#D97706" }}>+{track.pending}</span>
            )}
          </span>
        </div>
      </header>

      {error && (
        <div className="shrink-0 px-4 py-2" style={{ background: "#FEF2F2" }}>
          <p style={{ fontSize: "13px", color: "#B91C1C" }}>{error}</p>
        </div>
      )}

      {/* Карта + чек-ліст. На альбомній — поруч, на портретній — одне під
          одним: планшет у машині майже завжди горизонтально, але тримач
          буває й вертикальний. */}
      <div className="flex min-h-0 flex-1 flex-col landscape:flex-row">
        <div className="relative min-h-0 flex-1">
          <TabletDayMap stops={stops} trail={fullTrail} me={track.position} />
        </div>

        <aside
          className="min-h-0 shrink-0 overflow-y-auto landscape:h-auto landscape:w-[380px]"
          style={{
            background: "#fff",
            borderTop: "1px solid #E5E7EB",
            maxHeight: "45vh",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {!data ? (
            <p className="px-4 py-6" style={{ color: "#9CA3AF", fontSize: "14px" }}>
              Завантаження…
            </p>
          ) : stops.length === 0 ? (
            <div className="px-4 py-6">
              <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}>
                Маршрут на сьогодні порожній
              </p>
              <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "6px", lineHeight: 1.5 }}>
                Маршрутний лист ще не синхронізувався з 1С. Трек усе одно
                записується, а клієнта можна відмітити з картки на карті.
              </p>
            </div>
          ) : (
            <>
              {/* Підсумок дня: скільки зібрано з того, що мали забрати */}
              <div
                className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5"
                style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}
              >
                <span style={{ fontSize: "13px", color: "#6B7280" }}>
                  Лишилось <strong style={{ color: "#0A0A0A" }}>{data.progress.left}</strong>
                </span>
                {data.progress.debtPlanned > 0 && (
                  <span style={{ fontSize: "13px", color: "#6B7280" }}>
                    Зібрано{" "}
                    <strong style={{ color: "#16A34A" }}>
                      {money.format(data.progress.collected)}
                    </strong>{" "}
                    з {money.format(data.progress.debtPlanned)} грн
                  </span>
                )}
              </div>

              {stops.map((s) => (
                <StopRow
                  key={s.key}
                  stop={s}
                  open={openStop === s.key}
                  saving={saving === s.key}
                  onToggle={() => setOpenStop(openStop === s.key ? null : s.key)}
                  onMark={mark}
                />
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Рядок чек-ліста: згорнутий — статус, розгорнутий — кнопки й гроші. */
function StopRow({
  stop,
  open,
  saving,
  onToggle,
  onMark,
}: {
  stop: TabletStop;
  open: boolean;
  saving: boolean;
  onToggle: () => void;
  onMark: (
    stop: TabletStop,
    status: "DONE" | "MISSED",
    money: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE",
    extra?: { collectedAmount?: number; comment?: string }
  ) => void;
}) {
  const [partial, setPartial] = useState("");
  const [comment, setComment] = useState("");

  const done = stop.visit?.status === "DONE";
  const missed = stop.visit?.status === "MISSED";
  const hasDebt = stop.debtAmount > 0;

  return (
    <div
      style={{
        borderBottom: "1px solid #F3F4F6",
        background: done ? "#F0FDF4" : missed ? "#FEF2F2" : "#fff",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 text-left"
        style={{ background: "none", border: "none", padding: "12px 16px" }}
      >
        <span
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: "28px",
            height: "28px",
            background: done ? "#16A34A" : missed ? "#DC2626" : "#E5E7EB",
            color: done || missed ? "#fff" : "#374151",
            fontSize: "13px",
            fontWeight: 700,
          }}
        >
          {done ? "✓" : missed ? "×" : stop.sequence}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className="block truncate"
            style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}
          >
            {stop.name}
          </span>
          {stop.address && (
            <span
              className="block truncate"
              style={{ fontSize: "12px", color: "#6B7280", marginTop: "1px" }}
            >
              {stop.address}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-2" style={{ marginTop: "3px" }}>
            {stop.amount > 0 && (
              <span style={{ fontSize: "12px", color: "#374151" }}>
                {money.format(stop.amount)} грн
              </span>
            )}
            {hasDebt && (
              <span style={{ fontSize: "12px", color: "#DC2626", fontWeight: 600 }}>
                борг {money.format(stop.debtAmount)}
              </span>
            )}
            {stop.visit?.collectedAmount != null && stop.visit.collectedAmount > 0 && (
              <span style={{ fontSize: "12px", color: "#16A34A", fontWeight: 600 }}>
                забрано {money.format(stop.visit.collectedAmount)}
              </span>
            )}
            {stop.geoSource !== "MANUAL" && stop.lat != null && (
              <span style={{ fontSize: "11px", color: "#D97706" }}>точка приблизна</span>
            )}
          </span>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {/* Головні дві кнопки — великі, поруч: приїхав / не потрапив */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                onMark(stop, "DONE", hasDebt ? "FULL" : "NOT_APPLICABLE", {
                  comment: comment || undefined,
                })
              }
              style={{
                flex: 1,
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: "#16A34A",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 700,
                opacity: saving ? 0.5 : 1,
              }}
            >
              {hasDebt ? `Приїхав, забрав ${money.format(stop.debtAmount)}` : "Приїхав"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onMark(stop, "MISSED", "NOT_APPLICABLE", { comment: comment || undefined })}
              style={{
                flex: 1,
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: "#DC2626",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 700,
                opacity: saving ? 0.5 : 1,
              }}
            >
              Не потрапив
            </button>
          </div>

          {/* Гроші: тільки якщо є що забирати */}
          {hasDebt && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => onMark(stop, "DONE", "NONE", { comment: comment || undefined })}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: "10px",
                  border: "1px solid #E5E7EB",
                  background: "#fff",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Не забрав нічого
              </button>
              <input
                inputMode="decimal"
                value={partial}
                onChange={(e) => setPartial(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="Сума"
                style={{
                  width: "96px",
                  padding: "11px",
                  borderRadius: "10px",
                  border: "1px solid #E5E7EB",
                  fontSize: "15px",
                  textAlign: "center",
                }}
              />
              <button
                type="button"
                disabled={saving || !partial}
                onClick={() =>
                  onMark(stop, "DONE", "PARTIAL", {
                    collectedAmount: Number(partial.replace(",", ".")),
                    comment: comment || undefined,
                  })
                }
                style={{
                  padding: "11px 16px",
                  borderRadius: "10px",
                  border: "none",
                  background: partial ? "#0A0A0A" : "#E5E7EB",
                  color: partial ? "#fff" : "#9CA3AF",
                  fontSize: "14px",
                  fontWeight: 700,
                }}
              >
                ОК
              </button>
            </div>
          )}

          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Коментар: магазин закритий, немає грошей…"
            style={{
              width: "100%",
              marginTop: "8px",
              padding: "11px",
              borderRadius: "10px",
              border: "1px solid #E5E7EB",
              fontSize: "14px",
            }}
          />

          {stop.visit?.status && (
            <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "8px" }}>
              Відмічено. Натисніть іншу кнопку, щоб виправити.
            </p>
          )}

          {stop.lat != null && stop.lng != null && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`}
              target="_blank"
              rel="noopener"
              style={{
                display: "block",
                marginTop: "8px",
                padding: "12px",
                borderRadius: "10px",
                background: "#2563EB",
                color: "#fff",
                textAlign: "center",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              Навігація до точки
            </a>
          )}
        </div>
      )}
    </div>
  );
}
