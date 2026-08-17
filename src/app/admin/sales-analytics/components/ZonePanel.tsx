"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { Skeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import type { Period } from "@/components/ui/PeriodPicker";
import type { ZoneOverlay, ZonePoint } from "@/components/map/RoutesOverviewMap";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

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
  rings: Array<Array<[number, number]>>;
  edited: boolean;
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

export function ZonePanel({
  templateId,
  templateName,
  period,
  onZoneChange,
  editing,
  onEditingChange,
  pendingRings,
  canEdit = false,
}: {
  templateId: string | null;
  templateName: string | null;
  period: Period;
  /** Смуга і точки для мапи — малює батьківський RoutesTab */
  onZoneChange: (zone: ZoneOverlay | null) => void;
  /** Режим правки межі — стан живе в батьку, бо ручки малює мапа */
  editing: boolean;
  onEditingChange: (value: boolean) => void;
  /** Межа, яку адмін наразі перетягнув, але ще не зберіг */
  pendingRings: Array<Array<[number, number]>> | null;
  canEdit?: boolean;
}) {
  const [radiusKm, setRadiusKm] = useState(10);
  const [hidden, setHidden] = useState<Set<ZoneKind>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi<ZoneResponse>(
    templateId
      ? `/api/admin/route-templates/${templateId}/zone?from=${period.from}&to=${period.to}&radius=${radiusKm}`
      : null
  );

  const visible = useMemo(
    () => (data?.opportunities ?? []).filter((o) => !hidden.has(o.kind)),
    [data, hidden]
  );

  // Межа приходить готовою з сервера: об'єднання полігонів для 4000-точкової
  // осі — помітна робота, і в браузері вона повторювалася б на кожен рух
  // повзунка радіуса.
  const overlay = useMemo<ZoneOverlay | null>(() => {
    if (!data) return null;
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
    return { rings: data.rings, points, edited: data.edited };
  }, [data, visible]);

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

  async function saveBoundary() {
    if (!templateId || !pendingRings) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/route-templates/${templateId}/zone`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rings: pendingRings, radiusKm }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти межу");
      onEditingChange(false);
      // Перечитуємо: після ручної межі змінюється не лише контур, а й самі
      // цифри — хто тепер у зоні, а хто випав.
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Не вдалося зберегти межу");
    } finally {
      setSaving(false);
    }
  }

  async function resetBoundary() {
    if (!templateId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/route-templates/${templateId}/zone`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Не вдалося скинути межу");
      }
      onEditingChange(false);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Не вдалося скинути межу");
    } finally {
      setSaving(false);
    }
  }

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
        hint={
          data?.edited
            ? "Межу цієї зони виправлено вручну. Радіус більше на неї не впливає — поверніть автоматичну, щоб рахувалась від маршруту."
            : "Смуга вздовж маршруту: усе, що в неї потрапляє, торговий проїжджає майже без гака. Крутіть радіус — список перерахується."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* Радіус ховаємо в режимі правки: він там нічого не змінює, і
                повзунок, що ні на що не впливає, збиває з пантелику. */}
            {!editing && !data?.edited && (
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
                  className="w-32 cursor-pointer accent-[#0B7285]"
                />
                <span className="w-12 text-xs font-semibold tabular-nums text-bk">{radiusKm} км</span>
              </div>
            )}

            {canEdit && data && (
              <div className="flex items-center gap-1.5">
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={saveBoundary}
                      disabled={saving || !pendingRings}
                      className="cursor-pointer rounded-[var(--radius-btn)] bg-[#0B7285] px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-[#095c6b] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? "Збереження…" : pendingRings ? "Зберегти межу" : "Посуньте межу"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditingChange(false)}
                      disabled={saving}
                      className="cursor-pointer rounded-[var(--radius-btn)] border border-g300 bg-white px-3 py-1.5 text-xs text-bk transition-colors duration-200 hover:border-g400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Скасувати
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onEditingChange(true)}
                    className="cursor-pointer rounded-[var(--radius-btn)] border border-g300 bg-white px-3 py-1.5 text-xs text-bk transition-colors duration-200 hover:border-g400"
                  >
                    Правити межу
                  </button>
                )}
                {data.edited && !editing && (
                  <button
                    type="button"
                    onClick={resetBoundary}
                    disabled={saving}
                    className="cursor-pointer rounded-[var(--radius-btn)] border border-g300 bg-white px-3 py-1.5 text-xs text-g500 transition-colors duration-200 hover:border-g400 hover:text-bk disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Автоматична
                  </button>
                )}
              </div>
            )}
          </div>
        }
      />

      {editing && (
        <p className="mb-3 rounded-[var(--radius-btn)] border border-[#0B7285]/30 bg-[#0B7285]/5 px-3 py-2 text-xs text-bk">
          Тягніть кружечки на межі, щоб посунути її. Сусідні точки їдуть слідом,
          тож межа лишається плавною. Зміни застосуються після «Зберегти межу».
        </p>
      )}

      {saveError && (
        <p role="alert" className="mb-3 text-xs text-[#e34948]">
          {saveError}
        </p>
      )}

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
            <TableScroll stickyHeader minWidth={720} className="mt-3">
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
