"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, num } from "@/components/ui/Stat";
import { StatCardSkeleton, TableSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { Badge } from "@/components/ui/Badge";
import { CATEGORICAL, efficiencyStatus, tripStatus } from "@/lib/analytics/colors";

/**
 * Поїздки з Telegram-бота: хто коли виїхав, скільки проїхав, де відмічався.
 *
 * Живиться наявним /api/admin/sales-reports — той уже рахує всі метрики,
 * дублювати їх у новому ендпоінті означало б два джерела правди для «км».
 */

const ShiftMap = dynamic(() => import("@/components/map/ShiftMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] w-full" />,
});

type Trip = {
  id: string;
  userId: string;
  userName: string;
  status: string;
  startedAt: string;
  startAddress: string | null;
  startLat: number | null;
  startLng: number | null;
  endedAt: string | null;
  endAddress: string | null;
  endLat: number | null;
  endLng: number | null;
  distanceKm: number | null;
  personalKm: number | null;
  odometerToGpsRatio: number | null;
  durationMinutes: number | null;
  checkpointsCount: number;
  odometerSuspicious: boolean;
  trackCoverage: number | null;
  trackDistanceKm: number | null;
  onRouteRatio: number | null;
  offRouteKm: number | null;
  excursionsCount: number;
  checkpoints: Array<{
    id: string;
    seq: number;
    lat: number;
    lng: number;
    address: string | null;
    createdAt: string;
    minutesFromPrev: number | null;
  }>;
};

type ReportsResponse = {
  kpis: {
    tripsCount: number;
    closedCount: number;
    openCount: number;
    abandonedCount: number;
    totalKm: number;
    checkpointsCount: number;
    totalHours: number;
    repsCount: number;
    suspiciousCount: number;
    personalKm: number;
  };
  workers: Array<{
    id: string;
    name: string;
    onTrip: boolean;
    tripsCount: number;
    daysWorked: number;
    totalKm: number;
    kmPerDay: number;
    checkpointsCount: number;
    kmPerCheckpoint: number;
    avgTripHours: number;
    suspiciousCount: number;
  }>;
  teamAvg: { kmPerDay: number; checkpointsPerDay: number; kmPerCheckpoint: number; avgTripHours: number };
  repsList: Array<{ id: string; name: string }>;
  trips: Trip[];
};

function kyivTime(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function kyivDate(iso: string): string {
  // en-CA дає рівно YYYY-MM-DD — формат, який очікує route-day і <input type="date">.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function TripsTab({
  period,
  rep,
  onRepChange,
  onShowDay,
}: {
  period: Period;
  rep: string;
  onRepChange: (id: string) => void;
  /** Відкриває мапу дня в сусідніх «Маршрутах» на цьому торговому й дні. */
  onShowDay?: (repId: string, date: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  const { data, loading, error, reload } = useApi<ReportsResponse>(
    `/api/admin/sales-reports?from=${period.from}&to=${period.to}${rep ? `&repId=${rep}` : ""}`
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <TableSkeleton rows={6} cols={5} />
      </div>
    );
  }

  if (!data) return null;

  const mapPoints = data.trips.flatMap((t) => [
    ...(t.startLat != null && t.startLng != null
      ? [{
          lat: t.startLat,
          lng: t.startLng,
          type: "open" as const,
          workerName: t.userName,
          time: kyivTime(t.startedAt),
          address: t.startAddress,
          shiftId: t.id,
        }]
      : []),
    ...t.checkpoints.map((c) => ({
      lat: c.lat,
      lng: c.lng,
      type: "checkpoint" as const,
      workerName: t.userName,
      time: kyivTime(c.createdAt),
      address: c.address,
      shiftId: t.id,
      seq: c.seq,
    })),
    ...(t.endLat != null && t.endLng != null && t.endedAt
      ? [{
          lat: t.endLat,
          lng: t.endLng,
          type: "close" as const,
          workerName: t.userName,
          time: kyivTime(t.endedAt),
          address: t.endAddress,
          shiftId: t.id,
        }]
      : []),
  ]);

  return (
    <div className="space-y-4">
      {data.repsList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="trips-rep" className="text-xs font-medium text-g500">
            Торговий:
          </label>
          <select
            id="trips-rep"
            value={rep}
            onChange={(e) => onRepChange(e.target.value)}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs text-bk transition-colors hover:border-g300"
          >
            <option value="">Усі торгові</option>
            {data.repsList.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowMap((v) => !v)}
            aria-pressed={showMap}
            className={`cursor-pointer rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-medium transition-colors ${
              showMap ? "bg-bk text-white" : "border border-g200 bg-white text-g600 hover:border-g300 hover:text-bk"
            }`}
          >
            Карта
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Поїздок" value={num(data.kpis.tripsCount)} hint={`${data.kpis.openCount} відкритих`} accent={CATEGORICAL[0]} />
        <StatCard label="Пробіг" value={num(data.kpis.totalKm)} unit="км" hint={`особисті: ${num(data.kpis.personalKm)} км`} accent={CATEGORICAL[1]} />
        <StatCard label="Візитів" value={num(data.kpis.checkpointsCount)} accent={CATEGORICAL[2]} />
        <StatCard
          label="Км на точку"
          value={num(data.teamAvg.kmPerCheckpoint, 1)}
          tone={data.kpis.suspiciousCount > 0 ? "warn" : "default"}
          hint={data.kpis.suspiciousCount > 0 ? `${data.kpis.suspiciousCount} підозрілих` : "у середньому"}
        />
      </div>

      {showMap && mapPoints.length > 0 && (
        <Card>
          <CardHeader title="Точки поїздок" hint="Зелений — виїзд, синій — візит, червоний — повернення" />
          <ShiftMap points={mapPoints} connectRoute />
        </Card>
      )}

      {data.workers.length > 0 && (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Показники торгових"
              hint="«Км на точку» — головна метрика: високе значення означає багато їзди заради малої кількості візитів."
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Торговий</th>
                  <th className="px-4 py-2.5 text-right">Поїздок</th>
                  <th className="px-4 py-2.5 text-right">Днів</th>
                  <th className="px-4 py-2.5 text-right">Км</th>
                  <th className="px-4 py-2.5 text-right">Км/день</th>
                  <th className="px-4 py-2.5 text-right">Візитів</th>
                  <th className="px-4 py-2.5 text-right">Км/точку</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {data.workers.map((w) => (
                  <tr key={w.id} className="hover:bg-g50">
                    <td className="px-4 py-3 font-medium text-bk">
                      {w.name}
                      {w.onTrip && (
                        <span className="ml-2 inline-block align-middle">
                          <Badge status="info" dot>у дорозі</Badge>
                        </span>
                      )}
                      {w.suspiciousCount > 0 && (
                        <span className="ml-2 inline-block align-middle">
                          <Badge status="warn">{w.suspiciousCount} підозрілих</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(w.tripsCount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(w.daysWorked)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">{num(w.totalKm)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(w.kmPerDay, 1)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(w.checkpointsCount)}</td>
                    <td className="px-4 py-3 text-right">
                      {w.kmPerCheckpoint > 0 ? (
                        <Badge status={efficiencyStatus(w.kmPerCheckpoint, data.teamAvg.kmPerCheckpoint)}>
                          {num(w.kmPerCheckpoint, 1)}
                        </Badge>
                      ) : (
                        <span className="text-g400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="Поїздки" hint="Клік по рядку показує точки візитів" />
        </div>
        {data.trips.length === 0 ? (
          <div className="pb-4">
            <EmptyState title="Немає поїздок за період" hint="Поїздки створює Telegram-бот, коли торговий надсилає локацію." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Торговий</th>
                  <th className="px-4 py-2.5">Виїзд</th>
                  <th className="px-4 py-2.5">Повернення</th>
                  <th className="px-4 py-2.5 text-right">Км</th>
                  <th className="px-4 py-2.5 text-right">Візитів</th>
                  <th className="px-4 py-2.5">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {data.trips.map((t) => (
                  <>
                    <tr
                      key={t.id}
                      onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                      className="cursor-pointer transition-colors hover:bg-g50"
                    >
                      <td className="px-4 py-3 font-medium text-bk">{t.userName}</td>
                      <td className="px-4 py-3 text-g600">
                        {kyivTime(t.startedAt)}
                        {t.startAddress && <span className="ml-1 text-xs text-g400">{t.startAddress}</span>}
                      </td>
                      <td className="px-4 py-3 text-g600">{t.endedAt ? kyivTime(t.endedAt) : "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                        {t.distanceKm != null ? num(t.distanceKm) : "—"}
                        {t.odometerSuspicious && <span className="ml-1 text-amber-600">!</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">{t.checkpointsCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge status={tripStatus(t.status)} dot>
                            {t.status === "CLOSED" ? "завершена" : t.status === "OPEN" ? "у дорозі" : "покинута"}
                          </Badge>

                          {/* Червоне — лише коли є що показати очима. Епізод уже
                              пройшов пороги (25+ хв і 8+ км поза коридором), тож
                              корки й об'їзди сюди не потрапляють. */}
                          {t.excursionsCount > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onShowDay?.(t.userId, kyivDate(t.startedAt));
                              }}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200 transition-colors hover:bg-red-100"
                              title={`Виїздів за межі маршруту: ${t.excursionsCount}. Поза маршрутом ${t.offRouteKm ?? 0} км. Клік — мапа дня цієї поїздки.`}
                            >
                              ⚠ поза маршрутом
                              {t.offRouteKm != null && ` ${num(t.offRouteKm)} км`}
                            </button>
                          )}

                          {/* Низьке покриття — не порушення, а «дня майже не
                              видно». Показуємо лише для довгих поїздок: коротка
                              й так дає малий відсоток. */}
                          {t.trackCoverage != null &&
                            t.trackCoverage < 0.4 &&
                            (t.durationMinutes ?? 0) >= 120 && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"
                                title="Трансляція геолокації працювала меншу частину поїздки — маршрут за цей день майже не записаний."
                              >
                                📡 трек {Math.round(t.trackCoverage * 100)}%
                              </span>
                            )}
                        </div>
                      </td>
                    </tr>
                    {/* Умова навмисно НЕ вимагає чекпоінтів: поїздка з
                        відхиленнями, але без жодної відмітки — це рівно той
                        випадок, заради якого контроль і робився. Сховати його
                        через порожній масив було б найгіршою поведінкою. */}
                    {expanded === t.id && (t.checkpoints.length > 0 || t.trackDistanceKm != null) && (
                      <tr key={`${t.id}-details`} className="bg-g50">
                        <td colSpan={6} className="px-4 py-3">
                          {t.trackDistanceKm != null && (
                            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-g600">
                              <span>
                                🛰 Трек: <b className="text-bk">{num(t.trackDistanceKm)} км</b>
                                {t.distanceKm != null && (
                                  <span className="text-g400"> / одометр {num(t.distanceKm)} км</span>
                                )}
                              </span>
                              {t.onRouteRatio != null && (
                                <span>
                                  🧭 На маршруті:{" "}
                                  <b className={t.onRouteRatio < 0.6 ? "text-red-600" : "text-bk"}>
                                    {Math.round(t.onRouteRatio * 100)}%
                                  </b>
                                </span>
                              )}
                              {t.offRouteKm != null && t.offRouteKm > 0 && (
                                <span className="text-red-600">
                                  ⚠ Поза маршрутом: <b>{num(t.offRouteKm)} км</b>
                                  {t.excursionsCount > 0 && ` (${t.excursionsCount} епізод.)`}
                                </span>
                              )}
                              {t.excursionsCount > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onShowDay?.(t.userId, kyivDate(t.startedAt));
                                  }}
                                  className="cursor-pointer font-medium text-bk underline decoration-g300 underline-offset-2 transition-colors hover:decoration-bk"
                                >
                                  Відкрити мапу дня з епізодами →
                                </button>
                              )}
                            </div>
                          )}
                          <ol className="space-y-1.5">
                            {t.checkpoints.map((c) => (
                              <li key={c.id} className="flex items-baseline gap-2 text-xs">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                                  {c.seq}
                                </span>
                                <span className="text-g600">{kyivTime(c.createdAt)}</span>
                                <span className="text-bk">{c.address ?? "адреса невідома"}</span>
                                {c.minutesFromPrev != null && (
                                  <span className="text-g400">+{c.minutesFromPrev} хв</span>
                                )}
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
