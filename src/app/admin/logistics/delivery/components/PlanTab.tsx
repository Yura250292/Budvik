"use client";

/**
 * «План» — те, що помічник пропонує на день, і що менеджер із цим робить.
 *
 * Колонки водіїв ліворуч, карта праворуч, під ними відкладені й ті, кого
 * немає на карті. Правка — перетягуванням між колонками, а з телефона
 * кнопкою «Дії → Перекинути»: адмінка справді відкривається з телефона, а
 * перетягувати рядок пальцем по екрану — не той інструмент.
 *
 * Порядок після правки НЕ перераховується сам. Кожен перерахунок — це
 * запити до OSRM на кожен маршрут, і робити їх після кожного руху рукою
 * означало б чекати по кілька секунд на кожен клік. Тому кілометри зникають
 * («—»), поки людина не натисне «Перерахувати порядок»: порожнє число
 * чесніше за старе — саме вигаданий кілометраж один раз уже потрапив у
 * розрахунок пального як факт.
 *
 * Автоматично нічого не рахуємо і при відкритті вкладки: план — це десятки
 * запитів до OSRM, і робити їх на кожен візит на сторінку означало б
 * витрату без потреби. План будується лише на натиск кнопки.
 *
 * Карта підключається через `dynamic`, як у RoutesTab: Leaflet на сервері
 * падає.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { OverviewRoute, LegendEntry } from "@/components/map/RoutesOverviewMap";
import StopPinModal from "@/components/routes/StopPinModal";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { formatPrice } from "@/lib/utils";
import type { PlanDayResponse, PlanRouteOut, PlanStopOut } from "@/lib/routes/build-day-plan";

const RoutesOverviewMap = dynamic(() => import("@/components/map/RoutesOverviewMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-[var(--radius-card)] bg-g100 text-sm text-g400">
      Завантаження карти…
    </div>
  ),
});

/** 0 = понеділок, як у build-day-plan.ts і в профілях звичок. */
const WEEKDAY = ["понеділок", "вівторок", "середу", "четвер", "пʼятницю", "суботу", "неділю"];

export default function PlanTab({ day }: { day: string }) {
  const [plan, setPlan] = useState<PlanDayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<{ counterpartyId: string; name: string; address: string | null } | null>(null);
  /** salesDocumentId → driverId: закріплення переживає перескладання плану. */
  const [pins, setPins] = useState<Record<string, string>>({});
  /** Склад маршрутів правили руками — кілометри більше не відповідають йому. */
  const [stale, setStale] = useState(false);

  /**
   * `fixed` — коли перераховуємо порядок уже виправленого складу; без нього
   * сервер розподіляє точки по водіях заново і будь-яке ручне перекидання
   * зникає.
   */
  const load = useCallback(
    async (fixed?: Array<{ driverId: string; salesDocumentIds: string[] }>) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/routes/plan-day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: day, pins, fixed }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Не вдалося скласти план");
        setPlan(data as PlanDayResponse);
        setStale(false);
        setMenuFor(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося скласти план");
      } finally {
        setLoading(false);
      }
    },
    [day, pins]
  );

  /*
   * Меню «Дії» закривається кліком у будь-яке інше місце.
   *
   * Без цього воно лишалося відкритим, поки не тапнути саме по кнопці, —
   * на телефоні це найдужче заважає, а вкладку відкривають і в дорозі.
   * Слухач вішаємо лише поки меню відкрите, і сам клік по кнопці до нього
   * не доходить (вона зупиняє розповсюдження).
   */
  useEffect(() => {
    if (menuFor === null) return;
    const close = () => setMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuFor]);

  // Зміна дня скидає план — старий рахувався на інший день, показувати
  // його далі означало б видавати вчорашній розподіл за сьогоднішній.
  // Автоматичного перерахунку тут немає навмисно: див. шапку файлу.
  useEffect(() => {
    setPlan(null);
    setError(null);
    setStale(false);
    setMenuFor(null);
    // Закріплення теж скидаємо: «цей їде завтра» не має сенсу для іншої
    // дати, а документ належить своєму дню.
    setPins({});
  }, [day]);

  /**
   * Перекинути точку іншому водію.
   *
   * Кілометри обох маршрутів після цього не чинні — і геометрія теж. Стару
   * лінію ОБОВ'ЯЗКОВО обнуляємо: вона малювала б обʼїзд через точку, якої в
   * маршруті вже немає, і саме вона поїхала б у базу при «Створити
   * маршрути». Порожня геометрія чесніша: карта покаже пунктир по прямій.
   */
  const moveStop = (salesDocumentId: string, toDriverId: string) => {
    // Закріплення за старим водієм знімаємо, інакше мітка показувала б
    // «закріплено» в новій колонці, а наступне «Скласти заново» тихо
    // повернуло б точку туди, звідки її щойно забрали руками.
    setPins((prev) => {
      if (!prev[salesDocumentId] || prev[salesDocumentId] === toDriverId) return prev;
      const next = { ...prev };
      delete next[salesDocumentId];
      return next;
    });
    setPlan((prev) => {
      if (!prev) return prev;
      let moved: PlanStopOut | null = null;
      const routes = prev.routes.map((r) => {
        const found = r.stops.find((s) => s.salesDocumentId === salesDocumentId);
        if (!found) return r;
        moved = found;
        return {
          ...r,
          stops: r.stops.filter((s) => s.salesDocumentId !== salesDocumentId),
          distanceKm: null,
          durationMin: null,
          returnKm: null,
          roundTripKm: null,
          fuelCost: null,
          geometry: null,
        };
      });
      if (!moved) return prev;
      return {
        ...prev,
        routes: routes.map((r) =>
          r.driverId === toDriverId
            ? {
                ...r,
                stops: [...r.stops, { ...moved!, sequence: r.stops.length + 1 }],
                distanceKm: null,
                durationMin: null,
                returnKm: null,
                roundTripKm: null,
                fuelCost: null,
                geometry: null,
              }
            : r
        ),
      };
    });
    setStale(true);
    setMenuFor(null);
  };

  /** Закріпити точку за водієм: наступне складання плану її не зрушить. */
  const pinStop = (salesDocumentId: string, driverId: string) => {
    setPins((prev) => ({ ...prev, [salesDocumentId]: driverId }));
    setMenuFor(null);
  };

  /** Зняти закріплення: закріпити помилково легко, і відчепити має бути так само легко. */
  const unpinStop = (salesDocumentId: string) => {
    setPins((prev) => {
      const next = { ...prev };
      delete next[salesDocumentId];
      return next;
    });
    setMenuFor(null);
  };

  /**
   * Ім'я водія за id — для мітки «закріплено за …».
   *
   * Беремо з `plan.drivers`, а не з маршрутів: закріплення може вказувати на
   * водія, у якого в поточному плані не лишилося жодної точки, і мітка
   * однаково мусить називати його ім'ям, а не технічним id.
   */
  const driverName = (driverId: string) =>
    plan?.drivers.find((d) => d.id === driverId)?.name ?? "невідомого водія";

  const reorder = () =>
    load(plan?.routes.map((r) => ({ driverId: r.driverId, salesDocumentIds: r.stops.map((s) => s.salesDocumentId) })));

  const mapRoutes: OverviewRoute[] = useMemo(
    () =>
      (plan?.routes ?? []).map((r) => ({
        id: r.driverId,
        name: r.driverName,
        color: r.color,
        // GeoJSON.LineString.coordinates — це number[][] (Position — довільний
        // масив), а карта чекає точну пару [lng, lat]; формою вони збігаються.
        geometry: r.geometry as OverviewRoute["geometry"],
        subtitle: r.reason,
        stops: r.stops.map((s) => ({ settlement: s.name, displayName: s.address, lat: s.lat, lng: s.lng, seq: s.sequence })),
      })),
    [plan]
  );

  const legend: LegendEntry[] = useMemo(
    () => (plan?.routes ?? []).map((r) => ({ label: `${r.driverName} — ${r.stops.length} точ.`, color: r.color })),
    [plan]
  );

  const apply = async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/routes/plan-day/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: plan.date,
          routes: plan.routes.map((r) => ({
            driverId: r.driverId,
            salesDocumentIds: r.stops.map((s) => s.salesDocumentId),
            distanceKm: r.distanceKm,
            geometry: r.geometry,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не вдалося створити маршрути");
      setPlan(null);
      // Плану на екрані більше немає — тож і попередження про застарілі
      // кілометри не має висіти над порожнім місцем.
      setStale(false);
      setMenuFor(null);
      setError(
        data.skipped?.length
          ? `Створено маршрутів: ${data.created.length}. Пропущено ${data.skipped.length} документів — вони вже потрапили в лист 1С.`
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося створити маршрути");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="min-h-[38px] cursor-pointer rounded-[var(--radius-btn)] bg-primary-dark px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            {loading ? "Рахую…" : plan ? "Скласти заново" : `Скласти план на ${day}`}
          </button>
          {plan && (
            <>
              <button
                type="button"
                onClick={reorder}
                disabled={loading}
                className={`min-h-[38px] cursor-pointer rounded-[var(--radius-btn)] border px-4 text-sm transition-colors disabled:opacity-50 ${
                  stale ? "border-primary-dark text-primary-dark" : "border-g200 text-bk hover:bg-g50"
                }`}
              >
                Перерахувати порядок
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={saving || plan.routes.length === 0}
                className="min-h-[38px] cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-4 text-sm text-bk transition-colors hover:bg-g50 disabled:opacity-50"
              >
                {saving ? "Створюю…" : "Створити маршрути"}
              </button>
              {Object.keys(pins).length > 0 && (
                <span className="text-xs text-g600">закріплено точок: {Object.keys(pins).length}</span>
              )}
            </>
          )}
        </div>
        {stale && (
          <div className="border-t border-g200 px-4 py-2 text-xs text-g600 sm:px-5">
            Склад правили руками — кілометри показані як «—», поки не натиснете «Перерахувати порядок».
          </div>
        )}
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && <CardSkeleton />}

      {plan && (
        <>
          {plan.routes.length === 0 ? (
            <Card>
              <p className="text-sm text-g600">На цей день немає активних водіїв або немає що везти.</p>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                {plan.routes.map((r) => (
                  <RouteColumn
                    key={r.driverId}
                    route={r}
                    others={plan.routes.filter((x) => x.driverId !== r.driverId)}
                    menuFor={menuFor}
                    setMenuFor={setMenuFor}
                    onMove={moveStop}
                    onPin={pinStop}
                    onUnpin={unpinStop}
                    pins={pins}
                    driverName={driverName}
                  />
                ))}
              </div>
              <RoutesOverviewMap routes={mapRoutes} legend={legend} height="520px" />
            </div>
          )}

          {plan.deferred.length > 0 && (
            <Card>
              <CardHeader title={`Відкладені — ${plan.deferred.length}`} />
              <div className="space-y-3 text-sm">
                {plan.deferred.map((d, i) => (
                  <div key={i}>
                    <div className="text-g600">
                      {d.reason}
                      {d.suggestWeekday !== null && ` — зазвичай цей напрямок їде в ${WEEKDAY[d.suggestWeekday]}`}
                    </div>
                    <div>{d.points.map((x) => `${x.name} (${formatPrice(x.amount)})`).join(", ")}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {plan.noPin.length > 0 && (
            <Card>
              <CardHeader title={`Без точки на карті — ${plan.noPin.length}`} hint="Пін лягає в картку клієнта — діятиме й на всі наступні маршрути" />
              <div className="space-y-1 text-sm">
                {plan.noPin.map((x) => (
                  <div key={x.salesDocumentId} className="flex items-center justify-between gap-2">
                    <span>
                      {x.name}
                      {x.address && <span className="text-g600"> · {x.address}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPinFor({ counterpartyId: x.counterpartyId, name: x.name, address: x.address })}
                      className="shrink-0 text-xs text-primary-dark"
                    >
                      Показати на карті
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {plan.outOfZone.length > 0 && (
            <Card>
              <CardHeader title={`Не наша розвозка — ${plan.outOfZone.length}`} />
              <div className="text-sm text-g600">{plan.outOfZone.map((x) => x.name).join(", ")} — поза Львівщиною, це доставка поштою.</div>
            </Card>
          )}

          {plan.noCounterparty.length > 0 && (
            <Card>
              <CardHeader title={`Без контрагента — ${plan.noCounterparty.length}`} />
              <div className="text-sm text-g600">
                У документі немає контрагента — ставити пін нема кому, шукати в 1С за номером:{" "}
                {plan.noCounterparty.map((x) => x.number).join(", ")}
              </div>
            </Card>
          )}

          {plan.internal.length > 0 && (
            <Card padded={false}>
              <CardHeader title={`Свої, не розвозка — ${plan.internal.length}`} />
              <div className="px-4 pb-4 text-sm text-g600">
                Склад, співробітники й торгові — у 1С їхні документи виглядають як звичайні реалізації,
                тому кажемо про них окремо, а не ховаємо:{" "}
                {plan.internal.map((x) => `${x.name} (${x.number})`).join(", ")}
              </div>
            </Card>
          )}

          {plan.notes.map((n, i) => (
            <div key={i} className="text-sm text-g600">
              {n}
            </div>
          ))}
        </>
      )}

      {pinFor && (
        <StopPinModal
          counterpartyId={pinFor.counterpartyId}
          name={pinFor.name}
          address={pinFor.address}
          lat={null}
          lng={null}
          approximate={false}
          onClose={() => setPinFor(null)}
          onSaved={() => {
            setPinFor(null);
            // Пін збережено — точка стане кандидатом, але тільки в новому
            // плані: досипати її в поточний означало б тихо змінити склад,
            // під який уже пораховані кілометри.
            setStale(true);
          }}
        />
      )}
    </div>
  );
}

function RouteColumn({
  route,
  others,
  menuFor,
  setMenuFor,
  onMove,
  onPin,
  onUnpin,
  pins,
  driverName,
}: {
  route: PlanRouteOut;
  others: PlanRouteOut[];
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  onMove: (salesDocumentId: string, toDriverId: string) => void;
  onPin: (salesDocumentId: string, driverId: string) => void;
  onUnpin: (salesDocumentId: string) => void;
  pins: Record<string, string>;
  /** Ім'я водія за його id — мітка мусить казати, ЗА КИМ закріплено */
  driverName: (driverId: string) => string;
}) {
  const total = route.stops.reduce((s, x) => s + x.amount, 0);

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-g200 p-3">
        <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: route.color }} />
        <strong className="text-sm">{route.driverName}</strong>
        <span className="text-sm text-g600">
          {route.stops.length} точ. · {formatPrice(total)} ·{" "}
          {route.distanceKm === null ? "— км" : `${Math.round(route.distanceKm)} км`}
          {route.durationMin !== null && ` · ${Math.round(route.durationMin)} хв`}
          {route.normalKm !== null && ` · звично ${Math.round(route.normalKm)} км`}
        </span>
      </div>
      <div className="px-3 py-2 text-xs text-g600">
        {route.reason}
        {route.orderFromDistance && " · порядок за відстанню: OSRM не відповів"}
      </div>
      <RouteMoney route={route} />
      {route.stops.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-g500">точок немає</div>
      ) : (
        <ul className="divide-y divide-g200">
          {route.stops.map((s) => (
            <li
              key={s.salesDocumentId}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", s.salesDocumentId)}
              className="flex items-start justify-between gap-2 px-3 py-2 text-sm"
            >
              <span>
                <span className="text-g600">{s.sequence}. </span>
                {s.name}
                <span className="text-g600"> · {formatPrice(s.amount)}</span>
                {pins[s.salesDocumentId] && (
                  <span className="text-xs text-primary-dark">
                    {" · закріплено за "}
                    {driverName(pins[s.salesDocumentId])}
                  </span>
                )}
                {s.neverDelivered && <span className="text-xs text-g600"> · у листах не бував</span>}
              </span>
              <span className="relative shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor(menuFor === s.salesDocumentId ? null : s.salesDocumentId);
                  }}
                  className="cursor-pointer text-xs text-primary-dark"
                >
                  Дії
                </button>
                {menuFor === s.salesDocumentId && (
                  <span className="absolute right-0 z-10 mt-1 flex flex-col rounded-[var(--radius-btn)] border border-g200 bg-white shadow-[var(--shadow-card)]">
                    {others.map((o) => (
                      <button
                        key={o.driverId}
                        type="button"
                        onClick={() => onMove(s.salesDocumentId, o.driverId)}
                        className="cursor-pointer whitespace-nowrap px-3 py-2 text-left text-xs hover:bg-g50"
                      >
                        Перекинути до {o.driverName}
                      </button>
                    ))}
                    {pins[s.salesDocumentId] ? (
                      <button
                        type="button"
                        onClick={() => onUnpin(s.salesDocumentId)}
                        className="cursor-pointer whitespace-nowrap border-t border-g200 px-3 py-2 text-left text-xs hover:bg-g50"
                      >
                        Зняти закріплення
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPin(s.salesDocumentId, route.driverId)}
                        className="cursor-pointer whitespace-nowrap border-t border-g200 px-3 py-2 text-left text-xs hover:bg-g50"
                      >
                        Закріпити за {route.driverName}
                      </button>
                    )}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/*
        Перетягування — для миші. З телефона рядок ловить лише клік, тож
        призначення водія завжди дублюється в меню «Дії» вище — це не
        альтернативний, а рівноправний спосіб, бо адмінку відкривають і в
        дорозі.
      */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain");
          if (id) onMove(id, route.driverId);
        }}
        className="border-t border-dashed border-g200 p-2 text-center text-xs text-g500"
      >
        перетягніть точку сюди
      </div>
    </Card>
  );
}

/**
 * Гроші рейсу одним рядком: день машини з дорогою назад, пальне за нормою
 * водія, його оплата за формулою зарплати, вал і що лишається фірмі.
 *
 * Після перенесення точки кілометри скинуті (roundTripKm = null) — тоді й
 * гроші не показуємо: старі числа описували б інший склад маршруту.
 */
function RouteMoney({ route }: { route: PlanRouteOut }) {
  const e = route.economics;
  if (route.roundTripKm === null || !e) return null;
  return (
    <div className="border-t border-g200 px-3 py-2 text-xs text-g600">
      День машини {Math.round(route.roundTripKm)} км
      {route.returnKm !== null && ` (з них назад ${Math.round(route.returnKm)})`}
      {e.fuel !== null && ` · пальне ${formatPrice(e.fuel)}${route.fuel.own ? "" : " (типове авто)"}`}
      {e.driverPay !== null && ` · водію ${formatPrice(e.driverPay)}`}
      {e.margin !== null && ` · вал ${e.marginEstimated ? "≈" : ""}${formatPrice(e.margin)}`}
      {e.result !== null && (
        <>
          {" · "}
          <strong className={e.result < 0 ? "text-red-700" : "text-green-700"}>
            {e.result < 0 ? "збиток " : "лишається "}
            {formatPrice(Math.abs(e.result))}
          </strong>
        </>
      )}
    </div>
  );
}
