"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";
import RoutePlanPanel from "@/components/routes/RoutePlanPanel";
import AssignDriverBar from "@/components/routes/AssignDriverBar";
import ClientSearch, { pinState, pinUnusable, type FoundClient } from "@/components/routes/ClientSearch";
import StopPinModal from "@/components/routes/StopPinModal";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { StatusKey } from "@/lib/analytics/colors";

// PLANNED — чернетка логіста, водій її НЕ бачить; ASSIGNED — передано.
const ROUTE_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Чернетка", ASSIGNED: "Передано водію", IN_PROGRESS: "В дорозі",
  COMPLETED: "Завершений", CANCELLED: "Скасований",
};
/** Стани лягають на спільну шкалу бейджів адмінки, без власних кольорів. */
const ROUTE_STATUS_BADGE: Record<string, StatusKey> = {
  PLANNED: "neutral", ASSIGNED: "info", IN_PROGRESS: "warn",
  COMPLETED: "good", CANCELLED: "bad",
};

/** Точки можна правити, поки водій не поїхав (дзеркало lib/routes/editable.ts) */
const EDITABLE = ["PLANNED", "ASSIGNED"];

/** Спільний вигляд полів форми — щоб не повторювати рядок вісім разів. */
const FIELD =
  "w-full rounded-[var(--radius-btn)] border border-g200 px-3 py-2 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark";

export default function DeliveryRoutesPage() {
  const { data: session } = useSession();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  // Помилка створення — у самій формі, а не системним alert(): вікно
  // браузера доводилося закривати, перш ніж побачити, що саме не так.
  const [formError, setFormError] = useState<string | null>(null);

  // Create form
  const [formDriverId, setFormDriverId] = useState("");
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formVehicle, setFormVehicle] = useState("");
  const [formFuelConsumption, setFormFuelConsumption] = useState("");
  const [formFuelPrice, setFormFuelPrice] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  // Клієнти, зібрані пошуком по базі: точки без накладної. Маршрут часто
  // складають по пам'яті («Коваль у Жовтанцях»), ще до документів.
  const [selectedClients, setSelectedClients] = useState<FoundClient[]>([]);
  // Кого зараз показуємо в карті. Пін живе в картці клієнта, тож поправити
  // його можна ще до створення маршруту — і виправлення лишиться назавжди.
  const [pinClient, setPinClient] = useState<FoundClient | null>(null);

  const role = (session?.user as any)?.role;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [routesRes, ordersRes, usersRes] = await Promise.all([
      fetch("/api/erp/delivery-routes"),
      fetch("/api/erp/sales?status=CONFIRMED"),
      fetch("/api/admin/users"),
    ]);
    const routesData = await routesRes.json();
    const ordersData = await ordersRes.json();
    const usersData = await usersRes.json();

    setRoutes(Array.isArray(routesData) ? routesData : []);
    setConfirmedOrders(Array.isArray(ordersData) ? ordersData : []);
    setDrivers(Array.isArray(usersData) ? usersData.filter((u: any) => u.role === "DRIVER") : []);
    setLoading(false);
  }, []);

  // Замовлення, які ще нікуди не поставлені: одна накладна живе рівно в
  // одному маршруті, тож пропонувати зайняті — значить ловити 409.
  const takenOrderIds = new Set<string>(
    routes.flatMap((r: any) =>
      (r.stops ?? [])
        .map((s: any) => s.salesDocument?.id)
        .filter(Boolean)
    )
  );
  const freeOrders = confirmedOrders.filter((o: any) => !takenOrderIds.has(o.id));

  useEffect(() => {
    if (["ADMIN", "MANAGER"].includes(role)) fetchData();
  }, [role, fetchData]);

  const toggleOrder = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const pickClient = (c: FoundClient) => {
    setSelectedClients((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
    // Точки на карті немає — відкриваємо карту одразу: у списку з десяти
    // точок цей клієнт загубиться, і водій поїде його шукати по селу.
    if (pinUnusable(c)) setPinClient(c);
  };

  const dropClient = (id: string) =>
    setSelectedClients((prev) => prev.filter((c) => c.id !== id));

  /** Пін підтверджено в карті — оновлюємо рядок тими самими координатами. */
  const applyPin = (id: string, lat: number, lng: number) =>
    setSelectedClients((prev) =>
      prev.map((c) => (c.id === id ? { ...c, lat, lng, geoSource: "MANUAL" } : c))
    );

  const handleCreate = async () => {
    setFormError(null);
    if (selectedOrderIds.length === 0 && selectedClients.length === 0) {
      setFormError("Оберіть замовлення або знайдіть клієнта в базі");
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch("/api/erp/delivery-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: formDriverId || null,
          date: formDate,
          vehicleInfo: formVehicle || null,
          fuelConsumption: formFuelConsumption ? parseFloat(formFuelConsumption) : null,
          fuelPricePer: formFuelPrice ? parseFloat(formFuelPrice) : null,
          notes: formNotes || null,
          salesDocumentIds: selectedOrderIds,
          counterpartyIds: selectedClients.map((c) => c.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || "Помилка"); }
      else {
        setShowCreate(false);
        setSelectedOrderIds([]);
        setSelectedClients([]);
        setFormDriverId(""); setFormVehicle(""); setFormNotes("");
        fetchData();
      }
    } catch { setFormError("Мережева помилка"); }
    setActionLoading(false);
  };

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  return (
    // Власного хедера тут немає: шапку, бічне меню й прокрутку дає
    // AdminShell, а другий рядок із назвою лише з'їдав перший екран.
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-bk sm:text-2xl">Маршрути доставки</h1>
          <p className="mt-0.5 text-sm text-g500">Шляхові листи для водіїв</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Список / Карта — два режими роботи з тими самими маршрутами.
              «Карта» веде в планувальник: він лишається за своїм URL, бо на
              нього є глибокі посилання з /manager/routes. */}
          <div className="flex gap-1 rounded-[var(--radius-btn)] bg-g100 p-0.5">
            <span className="rounded-[8px] bg-white px-3.5 py-1.5 text-[13px] font-semibold text-bk shadow-sm">
              Список
            </span>
            <Link
              href="/admin/erp/route-planner"
              className="rounded-[8px] px-3.5 py-1.5 text-[13px] font-medium text-g500 transition-colors hover:text-bk"
            >
              Карта
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover"
          >
            + Новий маршрут
          </button>
        </div>
      </div>

      <div>
        {loading ? (
          <TableSkeleton rows={5} cols={4} />
        ) : routes.length === 0 && !showCreate ? (
          <Card>
            <EmptyState
              title="Маршрутів ще немає"
              hint="Натисніть «Новий маршрут», щоб зібрати перший шляховий лист із підтверджених замовлень."
            />
          </Card>
        ) : null}

        {/* Create form */}
        {showCreate && (
          <Card className="mb-6">
            <CardHeader title="Новий маршрут" />

            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-[13px] text-g500">Дата</label>
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                  className={FIELD} />
              </div>
              <div>
                <label className="mb-1 block text-[13px] text-g500">Водій</label>
                <select value={formDriverId} onChange={(e) => setFormDriverId(e.target.value)}
                  className={`${FIELD} cursor-pointer`}>
                  <option value="">Не призначений</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[13px] text-g500">Транспорт</label>
                <input value={formVehicle} onChange={(e) => setFormVehicle(e.target.value)} placeholder="Напр: Renault Kangoo"
                  className={FIELD} />
              </div>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-[13px] text-g500">Витрата (л/100км)</label>
                <input type="number" step="0.1" value={formFuelConsumption} onChange={(e) => setFormFuelConsumption(e.target.value)}
                  placeholder="8.5" className={FIELD} />
              </div>
              <div>
                <label className="mb-1 block text-[13px] text-g500">Ціна палива (грн/л)</label>
                <input type="number" step="0.01" value={formFuelPrice} onChange={(e) => setFormFuelPrice(e.target.value)}
                  placeholder="54.90" className={FIELD} />
              </div>
              <div>
                <label className="mb-1 block text-[13px] text-g500">Примітка</label>
                <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className={FIELD} />
              </div>
            </div>

            {/* Select orders */}
            <h3 className="mb-2 text-sm font-semibold text-g500">
              Підтверджені замовлення ({freeOrders.length})
            </h3>
            {freeOrders.length === 0 ? (
              <p className="py-3 text-[13px] text-g400">Немає замовлень для маршруту</p>
            ) : (
              <div className="mb-4 max-h-60 space-y-2 overflow-auto rounded-[var(--radius-btn)] border border-g200 p-2">
                {freeOrders.map((o) => (
                  <label key={o.id} className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-btn)] p-2 transition-colors hover:bg-g50">
                    <input type="checkbox" checked={selectedOrderIds.includes(o.id)}
                      onChange={() => toggleOrder(o.id)}
                      className="h-[18px] w-[18px] cursor-pointer accent-primary" />
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-bk">{o.number}</span>
                      <span className="ml-2 text-[13px] text-g500">
                        {o.counterparty?.name || "—"}
                      </span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-bk">{formatPrice(o.totalAmount)}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Клієнти з бази — другий спосіб зібрати маршрут. Накладної ще
                немає (або її не буде взагалі), а їхати треба: логіст пише
                «Коваль Жовтанці» й додає точку. */}
            <h3 className="mb-2 mt-4 text-sm font-semibold text-g500">
              Клієнти з бази {selectedClients.length > 0 && `(${selectedClients.length})`}
            </h3>

            {selectedClients.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {selectedClients.map((c) => {
                  const pin = pinState(c);
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-bk">{c.name}</p>
                        <p className="truncate text-[12px] text-g500">
                          {c.address || "адреси в картці немає"}
                        </p>
                      </div>
                      {/* Точку можна поправити просто тут: пін лягає в картку
                          клієнта, тож виправлення діє й на всі майбутні
                          маршрути, а не лише на цей. */}
                      <button
                        type="button"
                        onClick={() => setPinClient(c)}
                        className="flex-shrink-0 cursor-pointer rounded-[6px] px-2 py-1 text-[11px] font-semibold"
                        style={
                          pin.exact
                            ? { border: "1px solid #BBF7D0", background: "#F0FDF4", color: "#166534" }
                            : { border: "1px solid #FCD34D", background: "#FFFBEB", color: "#92400E" }
                        }
                      >
                        📍 {pin.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => dropClient(c.id)}
                        title="Прибрати з маршруту"
                        className="flex-shrink-0 cursor-pointer rounded-[6px] border border-g200 px-2 py-1 text-[12px] text-g500 hover:bg-g50"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mb-4">
              <ClientSearch
                onPick={pickClient}
                pickedIds={selectedClients.map((c) => c.id)}
                onFixPin={(c) => setPinClient(c)}
              />
            </div>

            {formError && (
              <div className="mb-3">
                <ErrorBox message={formError} />
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={handleCreate}
                disabled={actionLoading || selectedOrderIds.length + selectedClients.length === 0}
                className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-6 py-3 text-[15px] font-bold text-bk transition-colors hover:bg-primary-hover disabled:opacity-50">
                {actionLoading
                  ? "Створюю..."
                  : `Створити маршрут (${selectedOrderIds.length + selectedClients.length} точок)`}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setFormError(null); setSelectedClients([]); }}
                className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-6 py-3 text-[15px] text-g600 transition-colors hover:bg-g50">
                Скасувати
              </button>
            </div>
          </Card>
        )}

        {/* Routes list */}
        {routes.length > 0 && (
          <div className="space-y-4">
            {routes.map((r) => (
              <Card key={r.id} padded={false} className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-g100 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="text-[15px] font-bold text-bk">{r.number}</span>
                    <Badge status={ROUTE_STATUS_BADGE[r.status] ?? "neutral"} dot={r.status === "IN_PROGRESS"}>
                      {ROUTE_STATUS_LABELS[r.status]}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-bk">{formatDate(r.date)}</p>
                    <p className="text-[13px] text-g500">
                      Водій: {r.driver?.name || "—"} | {r._count?.stops || 0} зупинок
                    </p>
                  </div>
                </div>
                {r.vehicleInfo && (
                  <div className="bg-g50 px-5 py-2 text-[13px] text-g500">
                    Авто: {r.vehicleInfo}
                    {r.fuelConsumption && ` | ${r.fuelConsumption} л/100км`}
                    {r.totalDistanceKm && ` | ${r.totalDistanceKm} км`}
                    {r.totalFuelCost && ` | Паливо: ${formatPrice(r.totalFuelCost)}`}
                  </div>
                )}
                {/* Передача водію — головна дія картки: поки її не зробили,
                    маршруту для водія не існує. */}
                <AssignDriverBar
                  routeId={r.id}
                  status={r.status}
                  driverId={r.driverId}
                  driverName={r.driver?.name ?? null}
                  date={r.date}
                  assignedAt={r.assignedAt ?? null}
                  stopsCount={r.stops?.length ?? 0}
                  drivers={drivers}
                  onChanged={fetchData}
                />
                <RoutePlanPanel
                  routeId={r.id}
                  driverId={r.driverId}
                  date={r.date}
                  stops={r.stops ?? []}
                  editable={EDITABLE.includes(r.status)}
                  availableOrders={freeOrders}
                  onChanged={fetchData}
                />
              </Card>
            ))}
          </div>
        )}
      </div>

      {pinClient && (
        <StopPinModal
          counterpartyId={pinClient.id}
          name={pinClient.name}
          address={pinClient.address}
          lat={pinClient.lat}
          lng={pinClient.lng}
          approximate={pinClient.geoSource !== "MANUAL"}
          onSaved={(lat, lng) => applyPin(pinClient.id, lat, lng)}
          onClose={() => setPinClient(null)}
        />
      )}
    </div>
  );
}
