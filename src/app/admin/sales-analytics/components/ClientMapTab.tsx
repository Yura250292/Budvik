"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { money } from "@/components/ui/Stat";
import type { Period } from "@/components/ui/PeriodPicker";
import { CLIENT_STATE, type ClientStateKey } from "@/lib/analytics/colors";
import { colorForRep } from "@/lib/routes/colors";
import type { OverviewRoute } from "@/components/map/RoutesOverviewMap";
import type { ClientPoint, MapAction, MapMode, ProspectPoint } from "@/components/map/ClientMap";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";
import { ClientCommentsModal } from "./ClientCommentsModal";

/**
 * Карта клієнтів: хто бере регулярно, хто збивається, кого вже втратили —
 * і де на цій же мапі точки, які треба розпрацювати.
 *
 * Сенс вкладки — просторовий: у таблиці не видно, що троє «сплячих»
 * стоять уздовж маршруту, яким торговий і так їздить щотижня. Тому
 * фільтри тут миттєві (дані вже в пам'яті), а не через новий запит.
 */

const ClientMap = dynamic(() => import("@/components/map/ClientMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-[clamp(300px,52vh,460px)] w-full" />,
});

const STATE_ORDER: ClientStateKey[] = ["ACTIVE", "NEW", "SLIPPING", "DORMANT", "LOST"];

type ClientMapResponse = {
  canEdit: boolean;
  period: { from: string; to: string; days: number };
  clients: ClientPoint[];
  unmapped: Array<{
    counterpartyId: string;
    name: string;
    address: string | null;
    state: ClientStateKey;
    amount: number;
    geoSource: string | null;
    reps: Array<{ id: string; name: string }>;
  }>;
  prospects: ProspectPoint[];
  reps: Array<{ id: string; name: string }>;
  counts: Record<ClientStateKey, number>;
  coverage: { classified: number; mapped: number; noAddress: number; geoFailed: number };
};

type GeocodeProgress = { candidates: number; geocoded: number; failed: number; pending: number };

type TemplatesResponse = {
  templates: Array<{
    id: string;
    name: string;
    color: string | null;
    routeGeometry: { type: string; coordinates: [number, number][] } | null;
    stops: Array<{ settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
  }>;
};

type ProspectDraft = {
  id: string | null;
  name: string;
  address: string;
  notes: string;
  assignedRepId: string;
  status: string;
  lat: number;
  lng: number;
};

const PROSPECT_STATUSES = [
  { value: "NEW", label: "Нова" },
  { value: "IN_PROGRESS", label: "В роботі" },
  { value: "CONVERTED", label: "Стала клієнтом" },
  { value: "REJECTED", label: "Відмова" },
];

export function ClientMapTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<ClientMapResponse>(
    `/api/admin/sales-analytics/client-map?from=${period.from}&to=${period.to}`
  );
  const geo = useApi<GeocodeProgress>("/api/admin/client-map/geocode");

  const [hiddenStates, setHiddenStates] = useState<Set<string>>(new Set());
  const [repFilter, setRepFilter] = useState<string>("all");
  const [showRoutes, setShowRoutes] = useState(false);
  const [showProspects, setShowProspects] = useState(true);
  const [mode, setMode] = useState<MapMode>("view");
  const [movingId, setMovingId] = useState<{ kind: "client" | "prospect"; id: string } | null>(null);
  const [draft, setDraft] = useState<ProspectDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showUnmapped, setShowUnmapped] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pickedIndex, setPickedIndex] = useState(-1);
  const [focus, setFocus] = useState<{ lat: number; lng: number; id?: string; nonce: number } | null>(null);
  const [commentsFor, setCommentsFor] = useState<{ id: string; name: string } | null>(null);

  // Шаблони тягнемо лише коли оверлей увімкнули: більшість сеансів карти
  // маршрути не потребує, а запит там важкий (геометрія всіх напрямків).
  const templates = useApi<TemplatesResponse>(showRoutes ? "/api/admin/route-templates" : null);

  const overlayRoutes: OverviewRoute[] = useMemo(() => {
    if (!showRoutes || !templates.data) return [];
    return templates.data.templates.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color ?? colorForRep(t.id),
      geometry: t.routeGeometry,
      stops: t.stops,
    }));
  }, [showRoutes, templates.data]);

  const visibleClients = useMemo(() => {
    if (!data) return [];
    return data.clients.filter((c) => {
      if (hiddenStates.has(c.state)) return false;
      if (repFilter !== "all" && !c.reps.some((r) => r.id === repFilter)) return false;
      return true;
    });
  }, [data, hiddenStates, repFilter]);

  const visibleProspects = useMemo(() => {
    if (!data || !showProspects || hiddenStates.has("PROSPECT")) return [];
    return data.prospects.filter(
      (p) => repFilter === "all" || p.assignedRep?.id === repFilter
    );
  }, [data, showProspects, hiddenStates, repFilter]);

  /**
   * Підказки пошуку.
   *
   * Шукаємо по назві, адресі й місту в дужках назви («(м.Мостиська)»), бо
   * саме так керівник і думає про клієнта: або прізвище, або де він.
   * Дані вже в пам'яті, тож запиту не потрібно — список звужується з
   * кожною літерою. Збіг на початку слова показуємо першим: «Стрий» має
   * знайти Стрий, а не «Бистриця».
   */
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !data) return [];

    type Suggestion = {
      key: string;
      kind: "client" | "prospect";
      id: string;
      name: string;
      hint: string;
      state: ClientStateKey;
      lat: number | null;
      lng: number | null;
      rank: number;
    };

    const rank = (haystack: string) => {
      const h = haystack.toLowerCase();
      const at = h.indexOf(q);
      if (at < 0) return -1;
      // Початок рядка або початок слова — вагоміше за збіг усередині.
      if (at === 0) return 0;
      return /[\s(,.«"]/.test(h[at - 1]) ? 1 : 2;
    };

    const out: Suggestion[] = [];

    for (const c of data.clients) {
      const r = Math.min(
        ...[rank(c.name), rank(c.address ?? "")].filter((x) => x >= 0).concat([99])
      );
      if (r === 99) continue;
      out.push({
        key: `c:${c.counterpartyId}`,
        kind: "client",
        id: c.counterpartyId,
        name: c.name,
        hint: CLIENT_STATE[c.state].label,
        state: c.state,
        lat: c.lat,
        lng: c.lng,
        rank: r,
      });
    }

    for (const p of data.prospects) {
      const r = Math.min(
        ...[rank(p.name), rank(p.address ?? "")].filter((x) => x >= 0).concat([99])
      );
      if (r === 99) continue;
      out.push({
        key: `p:${p.id}`,
        kind: "prospect",
        id: p.id,
        name: p.name,
        hint: "для розпрацювання",
        state: "PROSPECT",
        lat: p.lat,
        lng: p.lng,
        rank: r,
      });
    }

    // Ті, кого немає на карті, теж знаходимо — інакше пошук мовчить про
    // клієнта, який просто не геокодувався, і це виглядає як його відсутність.
    for (const u of data.unmapped) {
      const r = Math.min(
        ...[rank(u.name), rank(u.address ?? "")].filter((x) => x >= 0).concat([99])
      );
      if (r === 99) continue;
      out.push({
        key: `u:${u.counterpartyId}`,
        kind: "client",
        id: u.counterpartyId,
        name: u.name,
        hint: "немає на карті",
        state: u.state,
        lat: null,
        lng: null,
        rank: r + 3,
      });
    }

    return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "uk")).slice(0, 12);
  }, [query, data]);

  type Picked = (typeof suggestions)[number];

  const pickSuggestion = useCallback((s: Picked) => {
    setSearchOpen(false);
    setQuery(s.name);
    if (s.lat != null && s.lng != null) {
      setFocus({ lat: s.lat, lng: s.lng, id: s.kind === "client" ? s.id : undefined, nonce: Date.now() });
    } else {
      // Координат немає — показуємо його в списку «кого немає на карті».
      setShowUnmapped(true);
    }
  }, []);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchOpen(true);
      setPickedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPickedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickSuggestion(suggestions[pickedIndex >= 0 ? pickedIndex : 0]);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
    }
  };

  const toggleState = (key: string) => {
    setHiddenStates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Геокодування крутиться циклом: один запит встигає лише пачку. */
  const runGeocode = useCallback(
    async (retryFailed: boolean) => {
      setActionError(null);
      setBusy(retryFailed ? "retry" : "geocode");
      try {
        for (;;) {
          const res = await fetch("/api/admin/client-map/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ retryFailed }),
          });
          const json = await res.json().catch(() => null);
          if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
          geo.reload();
          if (!json.processed || !json.remaining) break;
        }
        reload();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Геокодування не вдалося");
      } finally {
        setBusy(null);
      }
    },
    [geo, reload]
  );

  const handleMapClick = useCallback(
    async (lat: number, lng: number) => {
      if (mode === "addProspect") {
        setMode("view");
        setDraft({
          id: null,
          name: "",
          address: "",
          notes: "",
          assignedRepId: repFilter !== "all" ? repFilter : "",
          status: "NEW",
          lat,
          lng,
        });
        return;
      }

      if (mode === "movePin" && movingId) {
        setMode("view");
        setActionError(null);
        const target = movingId;
        setMovingId(null);
        try {
          const url =
            target.kind === "client"
              ? `/api/admin/client-map/${target.id}`
              : `/api/admin/prospects/${target.id}`;
          const res = await fetch(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat, lng }),
          });
          const json = await res.json().catch(() => null);
          if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
          reload();
        } catch (e) {
          setActionError(e instanceof Error ? e.message : "Не вдалося перемістити точку");
        }
      }
    },
    [mode, movingId, repFilter, reload]
  );

  const handleAction = useCallback(
    (action: MapAction) => {
      if (action.kind === "moveClient") {
        setMovingId({ kind: "client", id: action.id });
        setMode("movePin");
        return;
      }
      if (action.kind === "moveProspect") {
        setMovingId({ kind: "prospect", id: action.id });
        setMode("movePin");
        return;
      }
      if (action.kind === "comments") {
        const c = data?.clients.find((x) => x.counterpartyId === action.id);
        if (c) setCommentsFor({ id: c.counterpartyId, name: c.name });
        return;
      }
      const p = data?.prospects.find((x) => x.id === action.id);
      if (!p) return;
      setDraft({
        id: p.id,
        name: p.name,
        address: p.address ?? "",
        notes: p.notes ?? "",
        assignedRepId: p.assignedRep?.id ?? "",
        status: p.status,
        lat: p.lat,
        lng: p.lng,
      });
    },
    [data]
  );

  const saveProspect = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setActionError("Вкажіть назву точки");
      return;
    }
    setBusy("prospect");
    setActionError(null);
    try {
      const isNew = !draft.id;
      const res = await fetch(isNew ? "/api/admin/prospects" : `/api/admin/prospects/${draft.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          address: draft.address.trim(),
          notes: draft.notes.trim(),
          assignedRepId: draft.assignedRepId || null,
          lat: draft.lat,
          lng: draft.lng,
          ...(isNew ? {} : { status: draft.status }),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setDraft(null);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не вдалося зберегти точку");
    } finally {
      setBusy(null);
    }
  };

  const deleteProspect = async () => {
    if (!draft?.id) return;
    setBusy("prospect");
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/prospects/${draft.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setDraft(null);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не вдалося видалити точку");
    } finally {
      setBusy(null);
    }
  };

  /** Геокодує адресу з форми — щоб точку можна було ставити не лише кліком. */
  const geocodeDraftAddress = async () => {
    if (!draft?.address.trim()) return;
    setBusy("geocodeOne");
    setActionError(null);
    try {
      const res = await fetch(`/api/geo/geocode?q=${encodeURIComponent(draft.address.trim())}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Адресу не знайдено");
      setDraft({ ...draft, lat: json.lat, lng: json.lng });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Адресу не знайдено");
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Skeleton className="h-[clamp(300px,52vh,460px)] w-full" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const pending = geo.data?.pending ?? 0;
  const failed = geo.data?.failed ?? 0;
  const counts: Record<string, number> = { ...data.counts, PROSPECT: data.prospects.length };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Карта клієнтів"
          hint={`Колір — як часто клієнт бере. Рахується за документами (візитів у даних немає), історія з січня 2026. На карті ${data.coverage.mapped} з ${data.coverage.classified} клієнтів.`}
        />

        {/* Пошук клієнта: підказки з тих самих даних, що вже в пам'яті */}
        <div className="relative mb-2">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPickedIndex(-1);
            }}
            onKeyDown={onSearchKeyDown}
            onFocus={() => setSearchOpen(true)}
            // Затримка: без неї клік по підказці не встигає спрацювати,
            // бо blur ховає список раніше за onClick.
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Пошук клієнта: назва, місто, адреса…"
            className="w-full rounded-[var(--radius-btn)] border border-line px-3 py-1.5 text-sm text-bk"
          />
          {searchOpen && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-[500] mt-1 max-h-[260px] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-white shadow-lg">
              {suggestions.map((s, i) => (
                <li key={s.key}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(s)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      i === pickedIndex ? "bg-bg2" : "hover:bg-bg2"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0"
                      style={{
                        background: CLIENT_STATE[s.state].color,
                        borderRadius: s.kind === "prospect" ? "2px" : "9999px",
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-bk">{s.name}</span>
                    <span className="shrink-0 truncate text-xs text-gr">
                      {s.hint}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && suggestions.length === 0 && (
            <p className="mt-1 text-xs text-gr">
              Нічого не знайдено. Клієнт без координат шукається у списку «кого немає на карті».
            </p>
          )}
        </div>

        {/* Фільтри */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            className="rounded-[var(--radius-btn)] border border-line bg-white px-2.5 py-1.5 text-sm text-bk"
          >
            <option value="all">Усі торгові</option>
            {data.reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-sm text-bk">
            <input type="checkbox" checked={showRoutes} onChange={(e) => setShowRoutes(e.target.checked)} />
            Показати маршрути
          </label>
          <label className="flex items-center gap-1.5 text-sm text-bk">
            <input
              type="checkbox"
              checked={showProspects}
              onChange={(e) => setShowProspects(e.target.checked)}
            />
            Точки розпрацювання
          </label>

          <button
            type="button"
            onClick={() => setMode(mode === "addProspect" ? "view" : "addProspect")}
            className="ml-auto rounded-[var(--radius-btn)] border border-line px-3 py-1.5 text-sm font-medium text-bk hover:bg-bg2"
          >
            {mode === "addProspect" ? "Скасувати" : "+ Точка для розпрацювання"}
          </button>
        </div>

        {/* Легенда-фільтр: клік ховає стан */}
        <div className="mb-3 flex flex-wrap gap-2">
          {[...STATE_ORDER, "PROSPECT" as const].map((key) => {
            const meta = CLIENT_STATE[key];
            const hidden = hiddenStates.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleState(key)}
                title={meta.hint}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  hidden ? "border-line bg-bg2 text-gr opacity-60" : "border-line bg-white text-bk"
                }`}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0"
                  style={{
                    background: meta.color,
                    borderRadius: key === "PROSPECT" ? "2px" : "9999px",
                  }}
                />
                <span className="font-medium">{meta.label}</span>
                <span className="text-gr">{counts[key] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {actionError && <div className="mb-3"><ErrorBox message={actionError} /></div>}

        <ClientMap
          clients={visibleClients}
          prospects={visibleProspects}
          overlayRoutes={overlayRoutes}
          mode={mode}
          onMapClick={handleMapClick}
          onAction={handleAction}
          focus={focus}
        />

        {/* Покриття і геокодування */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gr">
          <span>
            На карті <strong className="text-bk">{data.coverage.mapped}</strong> з{" "}
            <strong className="text-bk">{data.coverage.classified}</strong> клієнтів
          </span>
          {data.coverage.noAddress > 0 && <span>без адреси: {data.coverage.noAddress}</span>}
          {data.coverage.geoFailed > 0 && <span>адресу не знайдено: {data.coverage.geoFailed}</span>}

          {pending > 0 && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => runGeocode(false)}
              className="rounded-[var(--radius-btn)] bg-bk px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === "geocode" ? "Геокодую…" : `Геокодувати адреси (${pending})`}
            </button>
          )}
          {pending === 0 && failed > 0 && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => runGeocode(true)}
              className="rounded-[var(--radius-btn)] border border-line px-3 py-1.5 text-xs font-medium text-bk disabled:opacity-50"
            >
              {busy === "retry" ? "Пробую ще раз…" : `Повторити невдалі (${failed})`}
            </button>
          )}
          {data.unmapped.length > 0 && (
            <button
              type="button"
              onClick={() => setShowUnmapped((v) => !v)}
              className="text-xs underline"
            >
              {showUnmapped ? "Сховати" : "Показати"} тих, кого немає на карті
            </button>
          )}
        </div>

        {showUnmapped && (
          <div className="mt-3 max-h-[280px] overflow-y-auto rounded-[var(--radius-card)] border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg2 text-left text-xs text-gr">
                <tr>
                  <th className="px-3 py-2">Клієнт</th>
                  <th className="px-3 py-2">Адреса</th>
                  <th className="px-3 py-2">Стан</th>
                  <th className="px-3 py-2 text-right">Оборот</th>
                </tr>
              </thead>
              <tbody>
                {data.unmapped.map((c) => (
                  <tr key={c.counterpartyId} className="border-t border-line">
                    <td className="px-3 py-1.5">{c.name}</td>
                    <td className="px-3 py-1.5 text-gr">
                      {c.address?.trim() || (c.geoSource === "FAILED" ? "не знайдено" : "немає адреси")}
                    </td>
                    <td className="px-3 py-1.5" style={{ color: CLIENT_STATE[c.state].color }}>
                      {CLIENT_STATE[c.state].label}
                    </td>
                    <td className="px-3 py-1.5 text-right">{money(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.coverage.mapped === 0 && (
          <div className="mt-3">
            <EmptyState
              title="На карті ще немає точок"
              hint="Адреси клієнтів є в базі, але їх треба перевести в координати — натисніть «Геокодувати адреси». Це триває кілька хвилин і робиться один раз."
            />
          </div>
        )}
      </Card>

      {/* Форма точки для розпрацювання */}
      {draft && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-bk">
              {draft.id ? "Точка для розпрацювання" : "Нова точка для розпрацювання"}
            </h3>

            <div className="space-y-2.5">
              <label className="block text-sm">
                <span className="mb-1 block text-gr">Назва</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Магазин будматеріалів, м. Радехів"
                  className="w-full rounded-[var(--radius-btn)] border border-line px-2.5 py-1.5 text-bk"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-gr">Адреса (необовʼязково)</span>
                <div className="flex gap-1.5">
                  <input
                    value={draft.address}
                    onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                    placeholder="м. Радехів, вул. Львівська, 5"
                    className="w-full rounded-[var(--radius-btn)] border border-line px-2.5 py-1.5 text-bk"
                  />
                  <button
                    type="button"
                    onClick={geocodeDraftAddress}
                    disabled={!!busy || !draft.address.trim()}
                    title="Знайти адресу на карті й пересунути точку"
                    className="shrink-0 rounded-[var(--radius-btn)] border border-line px-2.5 text-sm text-bk disabled:opacity-50"
                  >
                    {busy === "geocodeOne" ? "…" : "Знайти"}
                  </button>
                </div>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-gr">Доручити торговому</span>
                <select
                  value={draft.assignedRepId}
                  onChange={(e) => setDraft({ ...draft, assignedRepId: e.target.value })}
                  className="w-full rounded-[var(--radius-btn)] border border-line bg-white px-2.5 py-1.5 text-bk"
                >
                  <option value="">— нікому —</option>
                  {data.reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>

              {draft.id && (
                <label className="block text-sm">
                  <span className="mb-1 block text-gr">Статус</span>
                  <select
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                    className="w-full rounded-[var(--radius-btn)] border border-line bg-white px-2.5 py-1.5 text-bk"
                  >
                    {PROSPECT_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block text-sm">
                <span className="mb-1 block text-gr">Нотатка</span>
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  rows={2}
                  placeholder="Що продає, з ким говорити, коли заїхати"
                  className="w-full rounded-[var(--radius-btn)] border border-line px-2.5 py-1.5 text-bk"
                />
              </label>

              <p className="text-xs text-gr">
                Координати: {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
              </p>
            </div>

            {actionError && <div className="mt-3"><ErrorBox message={actionError} /></div>}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={saveProspect}
                disabled={!!busy}
                className="rounded-[var(--radius-btn)] bg-bk px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Зберегти
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setActionError(null);
                }}
                className="rounded-[var(--radius-btn)] border border-line px-3.5 py-1.5 text-sm text-bk"
              >
                Скасувати
              </button>
              {draft.id && (
                <button
                  type="button"
                  onClick={deleteProspect}
                  disabled={!!busy}
                  className="ml-auto text-sm text-rd underline disabled:opacity-50"
                >
                  Видалити
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {commentsFor && (
        <ClientCommentsModal client={commentsFor} onClose={() => setCommentsFor(null)} />
      )}
    </div>
  );
}
