"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, num } from "@/components/ui/Stat";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { kyivToday } from "@/components/ui/PeriodPicker";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

/**
 * Маршрути: шаблони напрямків, тижневий розклад і мапа дня.
 *
 * Пункти вводяться назвами міст і сіл — геокодування робить сервер при
 * збереженні шаблону, тож адміну не треба знати координат.
 */

const RouteDayMap = dynamic(() => import("@/components/map/RouteDayMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-[460px] w-full" />,
});

const WEEKDAYS = [
  { value: 1, short: "Пн" },
  { value: 2, short: "Вт" },
  { value: 3, short: "Ср" },
  { value: 4, short: "Чт" },
  { value: 5, short: "Пт" },
  { value: 6, short: "Сб" },
  { value: 7, short: "Нд" },
];

type TemplatesResponse = {
  canEdit: boolean;
  templates: Array<{
    id: string;
    name: string;
    color: string | null;
    region: string | null;
    totalDistanceKm: number | null;
    assignmentsCount: number;
    stops: Array<{ id: string; settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
  }>;
};

type AssignmentsResponse = {
  canEdit: boolean;
  reps: Array<{ id: string; name: string }>;
  assignments: Array<{
    id: string;
    repId: string;
    templateId: string;
    templateName: string;
    templateColor: string | null;
    date: string | null;
    weekday: number | null;
  }>;
};

type RouteDayResponse = {
  day: string;
  rep: { id: string; name: string } | null;
  planned: {
    name: string;
    color: string | null;
    totalDistanceKm: number | null;
    routeGeometry: { type: string; coordinates: [number, number][] } | null;
    stops: Array<{ settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
    source: "DATE" | "WEEKDAY";
  } | null;
  trips: Array<{
    id: string;
    startTime: string;
    endTime: string | null;
    distanceKm: number | null;
    start: { lat: number; lng: number; address: string | null } | null;
    end: { lat: number; lng: number; address: string | null } | null;
    checkpoints: Array<{ id: string; lat: number; lng: number; address: string | null; seq: number; time: string }>;
  }>;
  summary: {
    tripsCount: number;
    checkpointsCount: number;
    distanceKm: number;
    plannedStops: number;
    plannedKm: number | null;
  };
};

export function RoutesTab() {
  const [day, setDay] = useState(() => kyivToday());
  const [mapRep, setMapRep] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", region: "Львівська", settlements: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const templates = useApi<TemplatesResponse>("/api/admin/route-templates");
  const assignments = useApi<AssignmentsResponse>("/api/admin/route-assignments");
  const routeDay = useApi<RouteDayResponse>(
    mapRep ? `/api/admin/sales-analytics/route-day?repId=${mapRep}&date=${day}` : null
  );

  async function createTemplate() {
    const settlements = form.settlements
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!form.name.trim() || settlements.length === 0) {
      setNotice("Вкажіть назву і хоча б один населений пункт");
      return;
    }

    setBusy(true);
    setNotice("Геокодування пунктів… це займає приблизно секунду на кожен.");
    try {
      const res = await fetch("/api/admin/route-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), region: form.region.trim() || null, settlements }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося створити маршрут");

      setNotice(
        json.failed?.length
          ? `Маршрут створено. Не знайдено на карті: ${json.failed.join(", ")}`
          : "Маршрут створено."
      );
      setForm({ name: "", region: form.region, settlements: "" });
      setCreating(false);
      templates.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Помилка створення");
    } finally {
      setBusy(false);
    }
  }

  async function assign(repId: string, weekday: number, templateId: string) {
    const existing = assignments.data?.assignments.find((a) => a.repId === repId && a.weekday === weekday);

    if (!templateId) {
      if (existing) {
        await fetch(`/api/admin/route-assignments?id=${existing.id}`, { method: "DELETE" });
        assignments.reload();
      }
      return;
    }

    await fetch("/api/admin/route-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repId, templateId, weekday }),
    });
    assignments.reload();
  }

  async function removeTemplate(id: string) {
    await fetch(`/api/admin/route-templates/${id}`, { method: "DELETE" });
    templates.reload();
    assignments.reload();
  }

  const error = templates.error ?? assignments.error;
  if (error) return <ErrorBox message={error} onRetry={() => { templates.reload(); assignments.reload(); }} />;
  if (templates.loading && !templates.data) return <CardSkeleton rows={4} />;

  const canEdit = templates.data?.canEdit ?? false;
  const reps = assignments.data?.reps ?? [];
  const list = templates.data?.templates ?? [];

  // Мапа: точки факту з поїздок дня
  const actualPoints = (routeDay.data?.trips ?? []).flatMap((trip) => [
    ...(trip.start
      ? [{ lat: trip.start.lat, lng: trip.start.lng, type: "start" as const, label: "Виїзд", time: trip.startTime, address: trip.start.address }]
      : []),
    ...trip.checkpoints.map((c) => ({
      lat: c.lat,
      lng: c.lng,
      type: "checkpoint" as const,
      label: `Точка №${c.seq}`,
      time: c.time,
      address: c.address,
      seq: c.seq,
    })),
    ...(trip.end
      ? [{ lat: trip.end.lat, lng: trip.end.lng, type: "end" as const, label: "Повернення", time: trip.endTime, address: trip.end.address }]
      : []),
  ]);

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-[var(--radius-card)] border border-g200 bg-g50 px-4 py-3 text-sm text-g600">
          {notice}
        </div>
      )}

      {/* --- Мапа дня --- */}
      <Card>
        <CardHeader
          title="Маршрут на день: план і факт"
          hint="Жовтим — запланований напрямок із розкладу, синім — де торговий реально відмічався."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={mapRep}
                onChange={(e) => setMapRep(e.target.value)}
                aria-label="Торговий"
                className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs text-bk transition-colors hover:border-g300"
              >
                <option value="">Оберіть торгового</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                aria-label="Дата"
                className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-2 py-1.5 text-xs text-bk"
              />
            </div>
          }
        />

        {!mapRep ? (
          <EmptyState
            title="Оберіть торгового і дату"
            hint="Побачите запланований маршрут із розкладу та фактичні відмітки з бота на одній карті."
          />
        ) : routeDay.loading ? (
          <Skeleton className="h-[460px] w-full" />
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="За планом"
                value={routeDay.data?.summary.plannedStops ?? 0}
                unit="пунктів"
                hint={routeDay.data?.planned?.name ?? "маршрут не призначено"}
              />
              <StatCard label="Фактичні точки" value={routeDay.data?.summary.checkpointsCount ?? 0} />
              <StatCard label="Проїхав" value={num(routeDay.data?.summary.distanceKm ?? 0)} unit="км" />
              <StatCard
                label="Планові км"
                value={routeDay.data?.summary.plannedKm != null ? num(routeDay.data.summary.plannedKm) : "—"}
                unit="км"
              />
            </div>

            {(routeDay.data?.planned?.stops.length ?? 0) === 0 && actualPoints.length === 0 ? (
              <EmptyState
                title="На цей день немає ні маршруту, ні поїздок"
                hint="Призначте маршрут у розкладі нижче або оберіть інший день."
              />
            ) : (
              <RouteDayMap
                plannedStops={routeDay.data?.planned?.stops ?? []}
                plannedGeometry={routeDay.data?.planned?.routeGeometry ?? null}
                plannedColor={routeDay.data?.planned?.color ?? "#FFB800"}
                actual={actualPoints}
              />
            )}
          </>
        )}
      </Card>

      {/* --- Тижневий розклад --- */}
      {canEdit && reps.length > 0 && (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Постійний розклад"
              hint="Який напрямок торговий об'їжджає в кожен день тижня. Разові заміни на конкретну дату мають пріоритет над цим розкладом."
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="sticky left-0 z-10 bg-g50 px-4 py-2.5">Торговий</th>
                  {WEEKDAYS.map((d) => (
                    <th key={d.value} className="px-3 py-2.5">
                      {d.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {reps.map((rep) => (
                  <tr key={rep.id} className="hover:bg-g50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-bk">{rep.name}</td>
                    {WEEKDAYS.map((d) => {
                      const current = assignments.data?.assignments.find(
                        (a) => a.repId === rep.id && a.weekday === d.value
                      );
                      return (
                        <td key={d.value} className="px-3 py-2">
                          <select
                            value={current?.templateId ?? ""}
                            onChange={(e) => assign(rep.id, d.value, e.target.value)}
                            aria-label={`Маршрут ${rep.name}, ${d.short}`}
                            className="w-full cursor-pointer rounded-[var(--radius-badge)] border border-g200 bg-white px-1.5 py-1 text-xs text-bk transition-colors hover:border-g300"
                          >
                            <option value="">—</option>
                            {list.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* --- Шаблони --- */}
      <Card>
        <CardHeader
          title="Напрямки"
          hint="Список міст і сіл. Координати визначаються автоматично при збереженні."
          action={
            canEdit && (
              <button
                type="button"
                onClick={() => setCreating((v) => !v)}
                className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3.5 py-2 text-xs font-semibold text-bk transition-colors hover:bg-primary-hover"
              >
                {creating ? "Скасувати" : "Новий напрямок"}
              </button>
            )
          }
        />

        {creating && (
          <div className="mb-4 space-y-2 rounded-[var(--radius-card)] border border-g200 bg-g50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Назва, напр. «Радехівський напрямок»"
                aria-label="Назва напрямку"
                className="flex-1 rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
              />
              <input
                value={form.region}
                onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                placeholder="Область"
                aria-label="Область"
                className="w-full rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark sm:w-44"
              />
            </div>
            <p className="text-xs text-g500">
              Область обовʼязкова: без неї однойменні села знаходяться в інших областях — «Лопатин» опиняється
              у Вінницькій. Для окремого пункту можна уточнити прямо в рядку: «Витків, Львівська».
            </p>
            <textarea
              value={form.settlements}
              onChange={(e) => setForm((f) => ({ ...f, settlements: e.target.value }))}
              rows={5}
              placeholder={"Населені пункти — по одному в рядку:\nРадехів\nЛопатин\nВитків"}
              className="w-full rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
            />
            <button
              type="button"
              onClick={createTemplate}
              disabled={busy}
              className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-bk-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Геокодування…" : "Створити"}
            </button>
          </div>
        )}

        {list.length === 0 ? (
          <EmptyState
            title="Ще немає напрямків"
            hint="Створіть перший — введіть назву та перелік населених пунктів."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((t) => (
              <div key={t.id} className="rounded-[var(--radius-card)] border border-g200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-bk">{t.name}</p>
                    <p className="mt-0.5 text-xs text-g500">
                      {t.region && `${t.region} · `}
                      {t.stops.length} пунктів
                      {t.totalDistanceKm != null && ` · ${num(t.totalDistanceKm)} км`}
                      {t.assignmentsCount > 0 && ` · у розкладі ${t.assignmentsCount}×`}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeTemplate(t.id)}
                      aria-label={`Видалити напрямок ${t.name}`}
                      className="shrink-0 cursor-pointer rounded-[var(--radius-badge)] p-1 text-g400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-g600">
                  {t.stops.map((s) => s.settlement).join(" → ")}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
