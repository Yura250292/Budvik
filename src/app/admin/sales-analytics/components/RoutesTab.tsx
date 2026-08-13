"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, num } from "@/components/ui/Stat";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { kyivToday, type Period } from "@/components/ui/PeriodPicker";
import { colorForRep } from "@/lib/routes/colors";
import { CLIENT_STATE, type ClientStateKey } from "@/lib/analytics/colors";
import type {
  OverviewRoute,
  LegendEntry,
  ZoneOverlay,
  MapClientPoint,
} from "@/components/map/RoutesOverviewMap";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { ZonePanel } from "./ZonePanel";

/**
 * Маршрути: шаблони напрямків, тижневий розклад, оглядова мапа і мапа дня.
 *
 * Пункти вводяться назвами міст і сіл — геокодування робить сервер при
 * збереженні шаблону, тож адміну не треба знати координат.
 */

const RouteDayMap = dynamic(() => import("@/components/map/RouteDayMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-[460px] w-full" />,
});

const RoutesOverviewMap = dynamic(() => import("@/components/map/RoutesOverviewMap"), {
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
    routeGeometry: { type: string; coordinates: [number, number][] } | null;
    stops: Array<{ id: string; settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
  }>;
};

/** З ендпойнта карти клієнтів беремо лише точки — решта полів тут не потрібна. */
type ClientsResponse = { clients: MapClientPoint[] };

type AssignmentsResponse = {
  canEdit: boolean;
  reps: Array<{ id: string; name: string; color: string | null }>;
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
    trackCoverage: number | null;
    onRouteRatio: number | null;
    offRouteKm: number | null;
    trackDistanceKm: number | null;
    track: Array<{ lat: number; lng: number }>;
    excursions: Array<{
      from: string;
      to: string;
      fromTime: string;
      toTime: string;
      minutes: number;
      km: number;
      maxDistanceM: number;
      lat: number;
      lng: number;
    }>;
  }>;
  summary: {
    tripsCount: number;
    checkpointsCount: number;
    distanceKm: number;
    plannedStops: number;
    plannedKm: number | null;
    trackKm: number;
    offRouteKm: number;
    excursionsCount: number;
    minCoverage: number | null;
  };
};

/** Що показує оглядова мапа: всі маршрути, маршрути одного торгового, чи один напрямок. */
type OverviewMode = { kind: "all" } | { kind: "rep"; repId: string } | { kind: "template"; templateId: string };

export function RoutesTab({
  period,
  focus,
}: {
  period: Period;
  /** Прийшов із «Поїздок» кліком «поза маршрутом»: мапа дня одразу на цій поїздці. */
  focus?: { repId: string; date: string } | null;
}) {
  const [day, setDay] = useState(() => focus?.date ?? kyivToday());
  const [mapRep, setMapRep] = useState(focus?.repId ?? "");

  useEffect(() => {
    if (focus) {
      setMapRep(focus.repId);
      setDay(focus.date);
    }
  }, [focus]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", region: "Львівська", settlements: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewMode>({ kind: "all" });
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  // Смугу зони рахує ZonePanel (там радіус і фільтри шарів), а малює мапа
  // тут — тому оверлей піднятий у спільного батька.
  const [zone, setZone] = useState<ZoneOverlay | null>(null);
  /** Правка межі: стан тут, бо ручки малює мапа, а кнопки — панель під нею. */
  const [zoneEditing, setZoneEditing] = useState(false);
  /** Межа, яку адмін перетягнув мишею, але ще не зберіг. */
  const [pendingRings, setPendingRings] = useState<Array<Array<[number, number]>> | null>(null);
  /** Шари карти напрямків. Маршрути ввімкнені завжди — це основа вкладки. */
  const [showRoutes, setShowRoutes] = useState(true);
  const [showZone, setShowZone] = useState(true);
  const [showClients, setShowClients] = useState(false);
  /** Які стани клієнтів показувати: та сама легенда, що на «Карті клієнтів». */
  const [hiddenStates, setHiddenStates] = useState<Set<ClientStateKey>>(new Set());
  const overviewRef = useRef<HTMLDivElement>(null);
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const templates = useApi<TemplatesResponse>("/api/admin/route-templates");
  const assignments = useApi<AssignmentsResponse>(
    `/api/admin/route-assignments?from=${period.from}&to=${period.to}`
  );
  const routeDay = useApi<RouteDayResponse>(
    mapRep ? `/api/admin/sales-analytics/route-day?repId=${mapRep}&date=${day}` : null
  );

  // Клієнти тягнуться лише коли шар увімкнули: відповідь важка (сотні точок
  // із портфелем і станами), а більшості сеансів роботи з розкладом вона
  // взагалі не потрібна.
  const clientsApi = useApi<ClientsResponse>(
    showClients ? `/api/admin/sales-analytics/client-map?from=${period.from}&to=${period.to}` : null
  );

  const mapClients = useMemo<MapClientPoint[]>(() => {
    if (!showClients || !clientsApi.data) return [];
    return clientsApi.data.clients.filter((c) => !hiddenStates.has(c.state));
  }, [showClients, clientsApi.data, hiddenStates]);

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

  async function renameTemplate() {
    if (!renaming) return;
    const name = renaming.value.trim();
    setRenaming(null);
    if (!name) return;

    await fetch(`/api/admin/route-templates/${renaming.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    templates.reload();
    assignments.reload();
  }

  // Нативний color-picker шле change під час перетягування — без debounce це
  // десятки PATCH-ів на один вибір кольору.
  function setRepColor(repId: string, color: string) {
    if (colorTimer.current) clearTimeout(colorTimer.current);
    colorTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/users/${repId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setNotice(json?.error ?? "Не вдалося зберегти колір");
        return;
      }
      assignments.reload();
    }, 400);
  }

  // Маршрути для оглядової мапи. useMemo, бо кожен новий масив змушує мапу
  // перемальовуватись — а ререндер тут трапляється на кожен символ у формі.
  const { overviewRoutes, overviewLegend } = useMemo<{
    overviewRoutes: OverviewRoute[];
    overviewLegend: LegendEntry[];
  }>(() => {
    const all = templates.data?.templates ?? [];
    const byId = new Map(all.map((t) => [t.id, t]));
    const repList = assignments.data?.reps ?? [];
    const rows = assignments.data?.assignments ?? [];

    if (overview.kind === "template") {
      const t = byId.get(overview.templateId);
      if (!t) return { overviewRoutes: [], overviewLegend: [] };
      return {
        overviewRoutes: [
          {
            id: t.id,
            name: t.name,
            color: t.color ?? "#FFB800",
            geometry: t.routeGeometry,
            stops: t.stops,
            subtitle: t.region,
          },
        ],
        overviewLegend: [],
      };
    }

    // Один шаблон може стояти в розкладі торгового кілька разів (Пн і Чт) —
    // на мапі це один шар, а дні збираємо в підпис.
    const buildForRep = (rep: { id: string; name: string; color: string | null }): OverviewRoute[] => {
      const color = colorForRep(rep.id, rep.color);
      const days = new Map<string, string[]>();

      rows
        .filter((a) => a.repId === rep.id)
        .forEach((a) => {
          const label = a.weekday
            ? (WEEKDAYS.find((d) => d.value === a.weekday)?.short ?? "")
            : (a.date ?? "");
          const list = days.get(a.templateId) ?? [];
          if (label) list.push(label);
          days.set(a.templateId, list);
        });

      return [...days.entries()].flatMap(([templateId, labels]) => {
        const t = byId.get(templateId);
        if (!t) return []; // шаблон видалили, призначення ще не перечитали
        return [
          {
            id: `${rep.id}:${templateId}`,
            name: t.name,
            color,
            geometry: t.routeGeometry,
            stops: t.stops,
            subtitle: labels.length ? `${rep.name} · ${labels.join(", ")}` : rep.name,
          },
        ];
      });
    };

    if (overview.kind === "rep") {
      const rep = repList.find((r) => r.id === overview.repId);
      if (!rep) return { overviewRoutes: [], overviewLegend: [] };
      const routes = buildForRep(rep);
      return {
        overviewRoutes: routes,
        overviewLegend: routes.map((r) => ({ label: r.name, color: r.color })),
      };
    }

    const routes: OverviewRoute[] = [];
    const legend: LegendEntry[] = [];
    repList.forEach((rep) => {
      const repRoutes = buildForRep(rep);
      if (repRoutes.length === 0) return; // у легенді лише ті, кого видно на мапі
      routes.push(...repRoutes);
      legend.push({ label: rep.name, color: colorForRep(rep.id, rep.color) });
    });
    return { overviewRoutes: routes, overviewLegend: legend };
  }, [overview, templates.data, assignments.data]);

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

  // Трек і епізоди з усіх поїздок дня. Поїздок за день зазвичай одна, але
  // якщо їх кілька — треки не змішуємо в одну лінію: між поїздками був
  // розрив, і суцільна лінія намалювала б неіснуючий переїзд.
  const trackSegments = (routeDay.data?.trips ?? [])
    .map((t) => t.track)
    .filter((t) => t.length >= 2);
  const dayExcursions = (routeDay.data?.trips ?? []).flatMap((t) => t.excursions);

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
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard
                label="За планом"
                value={routeDay.data?.summary.plannedStops ?? 0}
                unit="пунктів"
                hint={routeDay.data?.planned?.name ?? "маршрут не призначено"}
              />
              <StatCard label="Фактичні точки" value={routeDay.data?.summary.checkpointsCount ?? 0} />
              <StatCard
                label="Проїхав"
                value={num(routeDay.data?.summary.distanceKm ?? 0)}
                unit="км"
                hint={
                  routeDay.data?.summary.plannedKm != null
                    ? `за планом ${num(routeDay.data.summary.plannedKm)} км`
                    : undefined
                }
              />
              <StatCard
                label="Під наглядом"
                value={
                  routeDay.data?.summary.minCoverage != null
                    ? `${Math.round(routeDay.data.summary.minCoverage * 100)}%`
                    : "—"
                }
                hint={
                  routeDay.data?.summary.minCoverage == null
                    ? "трек не працював"
                    : "частка часу з треком"
                }
              />
              <StatCard
                label="Поза маршрутом"
                value={num(routeDay.data?.summary.offRouteKm ?? 0)}
                unit="км"
                hint={
                  (routeDay.data?.summary.excursionsCount ?? 0) > 0
                    ? `${routeDay.data?.summary.excursionsCount} епізод(ів)`
                    : "відхилень немає"
                }
              />
            </div>

            {dayExcursions.length > 0 && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="mb-1.5 text-sm font-semibold text-red-800">
                  Виїзди за межі маршруту
                </div>
                <ul className="space-y-1 text-xs text-red-700">
                  {dayExcursions.map((e, i) => (
                    <li key={`${e.from}-${i}`}>
                      {e.fromTime}–{e.toTime} — {e.minutes} хв, {e.km} км,
                      найдалі {Math.round(e.maxDistanceM / 1000)} км від маршруту
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-[11px] text-red-600">
                  Корки й короткі об&apos;їзди сюди не потрапляють. Це привід уточнити
                  в торгового, а не готовий висновок.
                </div>
              </div>
            )}

            {(routeDay.data?.planned?.stops.length ?? 0) === 0 && actualPoints.length === 0 ? (
              <EmptyState
                title="На цей день немає ні маршруту, ні поїздок"
                hint="Призначте маршрут у розкладі нижче або оберіть інший день."
              />
            ) : (
              <>
                <RouteDayMap
                  plannedStops={routeDay.data?.planned?.stops ?? []}
                  plannedGeometry={routeDay.data?.planned?.routeGeometry ?? null}
                  plannedColor={routeDay.data?.planned?.color ?? "#FFB800"}
                  actual={actualPoints}
                  trackSegments={trackSegments}
                  excursions={dayExcursions}
                />

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-g500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 rounded" style={{ background: "#0EA5E9" }} />
                    Реальний трек
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 rounded border-t-2 border-dashed" style={{ borderColor: "#2563EB" }} />
                    Відмітки торгового
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-0.5 w-5 rounded"
                      style={{ background: routeDay.data?.planned?.color ?? "#FFB800" }}
                    />
                    Призначений маршрут
                  </span>
                  {dayExcursions.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 font-medium text-red-600">
                      <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-red-600" />
                      Відхилення ({dayExcursions.length})
                    </span>
                  )}
                </div>
              </>
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
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-bk">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          defaultValue={colorForRep(rep.id, rep.color)}
                          onChange={(e) => setRepColor(rep.id, e.target.value)}
                          aria-label={`Колір торгового ${rep.name} на карті`}
                          title="Колір на карті напрямків"
                          className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setOverview({ kind: "rep", repId: rep.id });
                            overviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          className="cursor-pointer text-left hover:underline"
                        >
                          {rep.name}
                        </button>
                      </div>
                    </td>
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
            {list.map((t) => {
              const selected = overview.kind === "template" && overview.templateId === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => {
                    setOverview({ kind: "template", templateId: t.id });
                    overviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOverview({ kind: "template", templateId: t.id });
                      overviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                  aria-label={`Показати напрямок ${t.name} на карті`}
                  className={`cursor-pointer rounded-[var(--radius-card)] border p-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark ${
                    selected ? "border-bk bg-g50" : "border-g200 hover:border-g300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {renaming?.id === t.id ? (
                        <input
                          autoFocus
                          value={renaming.value}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenaming({ id: t.id, value: e.target.value })}
                          onBlur={renameTemplate}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") renameTemplate();
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          aria-label={`Нова назва напрямку ${t.name}`}
                          className="w-full rounded-[var(--radius-btn)] border border-g300 px-2 py-1 text-sm font-semibold text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                        />
                      ) : (
                        <p className="truncate text-sm font-semibold text-bk">{t.name}</p>
                      )}
                      <p className="mt-0.5 text-xs text-g500">
                        {t.region && `${t.region} · `}
                        {t.stops.length} пунктів
                        {t.totalDistanceKm != null && ` · ${num(t.totalDistanceKm)} км`}
                        {t.assignmentsCount > 0 && ` · у розкладі ${t.assignmentsCount}×`}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenaming({ id: t.id, value: t.name });
                          }}
                          aria-label={`Перейменувати напрямок ${t.name}`}
                          className="cursor-pointer rounded-[var(--radius-badge)] p-1 text-g400 transition-colors hover:bg-g100 hover:text-bk"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTemplate(t.id);
                          }}
                          aria-label={`Видалити напрямок ${t.name}`}
                          className="cursor-pointer rounded-[var(--radius-badge)] p-1 text-g400 transition-colors hover:bg-red-50 hover:text-red-600"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-g600">
                    {t.stops.map((s) => s.settlement).join(" → ")}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* --- Оглядова мапа напрямків --- */}
      <div ref={overviewRef} className="scroll-mt-24">
        {/*
          Картка липне під шапкою шелла (top ≈ її висота), щоб при прокрутці
          списку зони під нею карта лишалася на екрані: смуга і список — одна
          думка, дивитися на них треба разом. z-30 — під шапкою (z-40), але
          понад контентом і власними z-індексами Leaflet. Висота карти
          обмежена в'юпортом (clamp, як на «Карті клієнтів»), інакше на
          ноутбуку липка картка була б вищою за екран і низ обрізався б.
          На мобільному стік вимкнено: карта на пів екрана з'їла б усе.
        */}
        <div className="lg:sticky lg:top-[120px] lg:z-30">
        <Card>
          <CardHeader
            title="Карта напрямків"
            hint="Кожен торговий має свій колір — так видно, хто за який напрямок відповідає. Оберіть торгового або окремий напрямок, щоб залишити на карті лише його."
            action={
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={overview.kind === "rep" ? overview.repId : ""}
                  onChange={(e) =>
                    setOverview(e.target.value ? { kind: "rep", repId: e.target.value } : { kind: "all" })
                  }
                  aria-label="Торговий на карті напрямків"
                  className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs text-bk transition-colors hover:border-g300"
                >
                  <option value="">Всі торгові</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select
                  value={overview.kind === "template" ? overview.templateId : ""}
                  onChange={(e) =>
                    setOverview(
                      e.target.value ? { kind: "template", templateId: e.target.value } : { kind: "all" }
                    )
                  }
                  aria-label="Напрямок на карті"
                  className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs text-bk transition-colors hover:border-g300"
                >
                  <option value="">Всі напрямки</option>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            }
          />

          {/*
            Шари. Клієнти вимкнені за замовчуванням: вкладка про маршрути, і
            378 точок поверх ліній роблять карту нечитабельною, поки їх
            свідомо не попросили.
          */}
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-g100 pb-3">
            <LayerToggle checked={showRoutes} onChange={setShowRoutes} label="Маршрути" />
            <LayerToggle
              checked={showZone}
              onChange={setShowZone}
              label="Зона напрямку"
              disabled={overview.kind !== "template"}
              hint={overview.kind !== "template" ? "Оберіть один напрямок" : undefined}
            />
            <LayerToggle
              checked={showClients}
              onChange={setShowClients}
              label="Клієнти"
              hint={clientsApi.loading ? "завантаження…" : undefined}
            />

            {showClients && (
              <div className="flex flex-wrap items-center gap-1.5">
                {(Object.keys(CLIENT_STATE) as ClientStateKey[])
                  .filter((k) => k !== "PROSPECT")
                  .map((key) => {
                    const meta = CLIENT_STATE[key];
                    const off = hiddenStates.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={!off}
                        title={meta.hint}
                        onClick={() =>
                          setHiddenStates((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                        className={`flex items-center gap-1.5 rounded-[var(--radius-btn)] border px-2 py-0.5 text-xs transition-colors ${
                          off ? "border-g200 bg-g50 text-g400" : "border-g300 bg-white text-bk hover:border-g400"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: off ? "#D1D5DB" : meta.color }}
                        />
                        {meta.label}
                      </button>
                    );
                  })}
              </div>
            )}
          </div>

          {overviewRoutes.length === 0 && !showClients ? (
            <EmptyState
              title={
                overview.kind === "all"
                  ? "Немає призначених маршрутів"
                  : "У цього вибору немає маршруту з координатами"
              }
              hint="Створіть напрямок вище і призначте його торговому в розкладі — тоді він з'явиться на карті."
            />
          ) : (
            <RoutesOverviewMap
              routes={showRoutes ? overviewRoutes : []}
              legend={showRoutes ? overviewLegend : []}
              zone={showZone && overview.kind === "template" ? zone : null}
              clients={mapClients}
              zoneEditing={zoneEditing}
              onZoneEdit={setPendingRings}
              height="clamp(300px, 52vh, 460px)"
            />
          )}
        </Card>
        </div>

        {/*
          Зона живе під картою напрямків, а не окремою вкладкою: смуга і
          список — це одна думка, і дивитися на них треба разом. Рахується
          лише для одного обраного напрямку — накладені коридори кількох
          маршрутів у план на день не читаються.
        */}
        <ZonePanel
          templateId={overview.kind === "template" ? overview.templateId : null}
          templateName={
            overview.kind === "template"
              ? (list.find((t) => t.id === overview.templateId)?.name ?? null)
              : null
          }
          period={period}
          onZoneChange={setZone}
          editing={zoneEditing}
          onEditingChange={(v) => {
            setZoneEditing(v);
            // Вихід із режиму скидає незбережене: інакше «Скасувати» лишало б
            // перетягнуту межу висіти в пам'яті до наступного збереження.
            if (!v) setPendingRings(null);
          }}
          pendingRings={pendingRings}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}

/**
 * Галочка шару карти.
 *
 * Нативний checkbox, а не стилізований div: шарів кілька, вони вмикаються
 * часто, і клавіатурна навігація з читалкою тут мусить працювати без
 * додаткової ролі та обробників.
 */
function LayerToggle({
  checked,
  onChange,
  label,
  disabled = false,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label
      title={hint}
      className={`flex select-none items-center gap-1.5 text-xs ${
        disabled ? "cursor-not-allowed text-g400" : "cursor-pointer text-bk"
      }`}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[#0F766E] disabled:cursor-not-allowed"
      />
      {label}
      {hint && <span className="text-g400">({hint})</span>}
    </label>
  );
}
