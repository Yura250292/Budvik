"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import type { Period } from "@/components/ui/PeriodPicker";
import type { ZoneOverlay, ZonePoint } from "@/components/map/RoutesOverviewMap";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

/**
 * Зона напрямку — те, що торговий може зачепити по дорозі.
 *
 * Панель відповідає на одне питання: «кого ще заїхати, поки я тут». Тому
 * головна колонка таблиці — відстань від маршруту, а не оборот: список
 * читається згори вниз як план на день, де перші рядки коштують п'ять
 * хвилин гака, а не годину.
 *
 * Повзунок радіуса б'є в API, а не фільтрує в пам'яті: коридор рахується
 * від геометрії маршруту (тисячі відрізків) проти сотень клієнтів, і
 * тягнути це в браузер означало б вантажити всю базу контрагентів заради
 * фільтра, який на сервері коштує мілісекунди.
 */

export type ZoneKind = "OTHER_REP" | "WINBACK" | "PROSPECT" | "WHITE_SPOT";

type ZoneResponse = {
  templateId: string;
  templateName: string;
  radiusKm: number;
  axis: Array<{ lat: number; lng: number }>;
  summary: {
    ownClients: number;
    ownRevenue: number;
    opportunities: number;
    byKind: Record<ZoneKind, number>;
    winbackRevenue: number;
    unmappedInRegion: number;
  };
  opportunities: Array<{
    kind: ZoneKind;
    id: string;
    name: string;
    lat: number;
    lng: number;
    distanceKm: number;
    address: string | null;
    state: string | null;
    amount: number | null;
    daysSinceLast: number | null;
    receivable: number | null;
    reps: Array<{ id: string; name: string }>;
    geoSource: string | null;
    spotCount: number | null;
  }>;
  assignedReps: Array<{ id: string; name: string }>;
};

const KIND_META: Record<ZoneKind, { label: string; color: string; hint: string }> = {
  OTHER_REP: {
    label: "Чужі та нічиї",
    color: "#2a78d6",
    hint: "Купують, але закріплені за іншим торговим або ні за ким",
  },
  WINBACK: {
    label: "Сплячі та втрачені",
    color: "#eb6834",
    hint: "Були клієнтами і перестали брати — найдешевші для повернення",
  },
  PROSPECT: {
    label: "Проспекти",
    color: "#4a3aa7",
    hint: "Точки, позначені на карті вручну",
  },
  WHITE_SPOT: {
    label: "Білі плями",
    color: "#6B7280",
    hint: "Населені пункти в коридорі, де ніхто нічого не брав за період",
  },
};

const STATE_LABEL: Record<string, string> = {
  ACTIVE: "Активний",
  NEW: "Новий",
  SLIPPING: "Збивається",
  DORMANT: "Спить",
  LOST: "Втрачений",
};

/** Радіус у метрах для кола Leaflet. */
const KM = 1000;

export function ZonePanel({
  templateId,
  templateName,
  period,
  onZoneChange,
}: {
  templateId: string | null;
  templateName: string | null;
  period: Period;
  /** Смуга і точки для мапи — малює батьківський RoutesTab */
  onZoneChange: (zone: ZoneOverlay | null) => void;
}) {
  const [radiusKm, setRadiusKm] = useState(10);
  const [hidden, setHidden] = useState<Set<ZoneKind>>(new Set());

  const { data, loading, error, reload } = useApi<ZoneResponse>(
    templateId
      ? `/api/admin/route-templates/${templateId}/zone?from=${period.from}&to=${period.to}&radius=${radiusKm}`
      : null
  );

  const visible = useMemo(
    () => (data?.opportunities ?? []).filter((o) => !hidden.has(o.kind)),
    [data, hidden]
  );

  // Смуга коридору будується тут, а не на сервері: геометрія залежить лише
  // від осі та радіуса, обидва вже в руках, і зайвий кілобайт у відповіді
  // API ні до чого.
  const overlay = useMemo<ZoneOverlay | null>(() => {
    if (!data) return null;
    const shapes = buildBandShapes(data.axis, radiusKm);
    const points: ZonePoint[] = visible.map((o) => ({
      id: o.id,
      kind: o.kind,
      name: o.name,
      lat: o.lat,
      lng: o.lng,
      distanceKm: o.distanceKm,
      subtitle:
        o.kind === "WHITE_SPOT"
          ? `${o.spotCount ?? 0} контрагентів, жодної покупки за період`
          : o.reps.length
            ? o.reps.map((r) => r.name).join(", ")
            : "Не закріплений ні за ким",
    }));
    return { shapes, points };
  }, [data, visible, radiusKm]);

  // Віддаємо смугу батькові, який малює мапу. Залежність — лише overlay:
  // onZoneChange приходить із батька новим посиланням на кожен його рендер,
  // і з ним у залежностях ефект ганявся б по колу.
  useEffect(() => {
    onZoneChange(overlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  // Прибрати смугу з мапи, коли панель зникає (змінили вибір на «Всі напрямки»).
  useEffect(() => {
    return () => onZoneChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!templateId) {
    return (
      <Card>
        <CardHeader
          title="Зона напрямку"
          hint="Оберіть один напрямок на карті вище — і побачите, кого можна зачепити по дорозі."
        />
        <EmptyState
          title="Напрямок не обрано"
          hint="Зона рахується для одного маршруту: у списку «Всі напрямки» коридори накладаються і план на день з них не читається."
        />
      </Card>
    );
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const s = data?.summary;

  return (
    <Card>
      <CardHeader
        title={`Зона напрямку${templateName ? ` · ${templateName}` : ""}`}
        hint="Смуга вздовж маршруту: усе, що в неї потрапляє, торговий проїжджає майже без гака. Крутіть радіус — список перерахується."
        action={
          <div className="flex items-center gap-2">
            <label htmlFor="zone-radius" className="whitespace-nowrap text-xs text-g500">
              Радіус
            </label>
            <input
              id="zone-radius"
              type="range"
              min={2}
              max={40}
              step={1}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="w-32 cursor-pointer accent-[#0F766E]"
            />
            <span className="w-12 text-xs font-semibold tabular-nums text-bk">{radiusKm} км</span>
          </div>
        }
      />

      {loading && !data ? (
        <Skeleton className="h-40 w-full" />
      ) : !s ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Свої клієнти в зоні"
              value={num(s.ownClients)}
              hint={s.ownRevenue > 0 ? `${money(s.ownRevenue)} за період` : "Немає обороту за період"}
            />
            <StatCard
              label="Є що розпрацювати"
              value={num(s.opportunities)}
              accent="#0F766E"
              hint="Точки в коридорі, які зараз не ваші"
            />
            <StatCard
              label="Сплячі та втрачені"
              value={num(s.byKind.WINBACK)}
              tone={s.byKind.WINBACK > 0 ? "warn" : "default"}
              hint={s.winbackRevenue > 0 ? `брали ${money(s.winbackRevenue)}` : "без обороту за період"}
            />
            <StatCard
              label="Білі плями"
              value={num(s.byKind.WHITE_SPOT)}
              hint="Пункти без жодної покупки"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(KIND_META) as ZoneKind[]).map((kind) => {
              const meta = KIND_META[kind];
              const off = hidden.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() =>
                    setHidden((prev) => {
                      const next = new Set(prev);
                      if (next.has(kind)) next.delete(kind);
                      else next.add(kind);
                      return next;
                    })
                  }
                  title={meta.hint}
                  aria-pressed={!off}
                  className={`flex items-center gap-1.5 rounded-[var(--radius-btn)] border px-2.5 py-1 text-xs transition-colors ${
                    off ? "border-g200 bg-g50 text-g400" : "border-g300 bg-white text-bk hover:border-g400"
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: off ? "#D1D5DB" : meta.color }}
                  />
                  {meta.label}
                  <span className="tabular-nums text-g500">{s.byKind[kind]}</span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title="У цьому коридорі нікого немає"
              hint="Спробуйте більший радіус або увімкніть приховані шари."
            />
          ) : (
            <TableScroll minWidth={720} className="mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-g200 text-left text-xs text-g500">
                    <th className="py-2 pr-3 font-medium">Від маршруту</th>
                    <th className="py-2 pr-3 font-medium">Назва</th>
                    <th className="py-2 pr-3 font-medium">Категорія</th>
                    <th className="py-2 pr-3 font-medium">Стан</th>
                    <th className="py-2 pr-3 text-right font-medium">Оборот</th>
                    <th className="py-2 pr-3 font-medium">Закріплений за</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 200).map((o) => {
                    const meta = KIND_META[o.kind];
                    return (
                      <tr key={o.id} className="border-b border-g100 last:border-0">
                        <td className="whitespace-nowrap py-2 pr-3 tabular-nums font-semibold text-bk">
                          {o.distanceKm.toFixed(1)} км
                        </td>
                        <td className="py-2 pr-3">
                          <span className="text-bk">{o.name}</span>
                          {o.address && <div className="text-xs text-g500">{o.address}</div>}
                          {o.geoSource === "CITY" && (
                            <div className="text-xs text-g400">пін у центрі НП — адресу треба уточнити</div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                            <span
                              aria-hidden
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: meta.color }}
                            />
                            {meta.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-xs text-g500">
                          {o.kind === "WHITE_SPOT"
                            ? `${o.spotCount ?? 0} контрагентів`
                            : o.state
                              ? `${STATE_LABEL[o.state] ?? o.state}${
                                  o.daysSinceLast != null ? ` · ${o.daysSinceLast} дн.` : ""
                                }`
                              : "—"}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-bk">
                          {o.amount != null && o.amount > 0 ? money(o.amount) : "—"}
                        </td>
                        <td className="py-2 pr-3 text-xs text-g500">
                          {o.reps.length ? o.reps.map((r) => r.name).join(", ") : "нічий"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}

          {visible.length > 200 && (
            <p className="mt-2 text-xs text-g500">
              Показано 200 найближчих із {num(visible.length)} — звузьте радіус або вимкніть шари.
            </p>
          )}

          {s.unmappedInRegion > 0 && (
            <p className="mt-2 text-xs text-g500">
              {num(s.unmappedInRegion)} клієнтів без координат у зону не потрапили взагалі — вони не
              враховані в жодній цифрі вище. Білі плями рахуються лише по населених пунктах, які вже є
              в адресах контрагентів: пункт, якого немає в базі, тут не з&apos;явиться.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Смуга навколо осі: прямокутник на кожен відрізок плюс коло на кожен стик.
 *
 * Дублює логіку lib/routes/corridor.ts свідомо — там серверна версія в
 * градусах для розрахунку відстані, тут клієнтська для Leaflet, який
 * хоче [lat,lng] і радіус у метрах. Спільний модуль вимагав би тягнути
 * серверні типи в бандл заради двадцяти рядків тригонометрії.
 */
function buildBandShapes(
  axis: Array<{ lat: number; lng: number }>,
  radiusKm: number
): ZoneOverlay["shapes"] {
  if (axis.length === 0) return { segments: [], circles: [] };

  const KM_PER_DEG_LAT = 111.32;
  const step = Math.max(0.5, radiusKm / 3);

  // Проріджування: у геометрії OSRM на 250 км понад тисяча точок, і тисяча
  // полігонів у Leaflet — це помітний фриз на кожен рух повзунка.
  const simplified: Array<{ lat: number; lng: number }> = [axis[0]];
  let last = axis[0];
  for (let i = 1; i < axis.length - 1; i++) {
    const p = axis[i];
    const kx = KM_PER_DEG_LAT * Math.cos((((last.lat + p.lat) / 2) * Math.PI) / 180);
    const dx = (p.lng - last.lng) * kx;
    const dy = (p.lat - last.lat) * KM_PER_DEG_LAT;
    if (Math.hypot(dx, dy) >= step) {
      simplified.push(p);
      last = p;
    }
  }
  if (axis.length > 1) simplified.push(axis[axis.length - 1]);

  const segments: Array<Array<[number, number]>> = [];
  for (let i = 0; i < simplified.length - 1; i++) {
    const a = simplified[i];
    const b = simplified[i + 1];
    const kx = KM_PER_DEG_LAT * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);

    const dx = (b.lng - a.lng) * kx;
    const dy = (b.lat - a.lat) * KM_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;

    const offLng = ((-dy / len) * radiusKm) / kx;
    const offLat = ((dx / len) * radiusKm) / KM_PER_DEG_LAT;

    segments.push([
      [a.lat + offLat, a.lng + offLng],
      [b.lat + offLat, b.lng + offLng],
      [b.lat - offLat, b.lng - offLng],
      [a.lat - offLat, a.lng - offLng],
    ]);
  }

  const circles = simplified.map((c) => ({
    center: [c.lat, c.lng] as [number, number],
    radiusM: radiusKm * KM,
  }));

  return { segments, circles };
}
