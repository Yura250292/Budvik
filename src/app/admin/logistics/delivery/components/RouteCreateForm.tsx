"use client";

/**
 * Скласти маршрут самому: з підтверджених замовлень і клієнтів бази.
 *
 * Форма з колишньої сторінки маршрутів, без змін по суті. Дві відмінності
 * від неї: дата підставляється з обраного дня (складають маршрут на день, на
 * який дивляться), а водій — з активного фільтра.
 *
 * Пошук клієнтів тут головніший за список замовлень: маршрут часто збирають
 * по памʼяті («Коваль у Жовтанцях»), ще до того, як менеджер виписав
 * документи. Тому в кожному рядку видно стан піна, а клієнту без координати
 * карта відкривається одразу — уточнена точка лягає в картку клієнта й діє
 * на всі майбутні маршрути.
 */

import { useState } from "react";
import { formatPrice } from "@/lib/utils";
import ClientSearch, { pinState, pinUnusable, type FoundClient } from "@/components/routes/ClientSearch";
import StopPinModal from "@/components/routes/StopPinModal";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { DayDriver, FreeOrder } from "./types";

const FIELD =
  "w-full rounded-[var(--radius-btn)] border border-g200 px-3 py-2 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark";

export default function RouteCreateForm({
  day,
  driverId,
  drivers,
  freeOrders,
  onCreated,
  onCancel,
}: {
  day: string;
  driverId: string | null;
  drivers: DayDriver[];
  freeOrders: FreeOrder[];
  onCreated: (routeId: string) => void;
  onCancel: () => void;
}) {
  const [formDate, setFormDate] = useState(day);
  const [formDriverId, setFormDriverId] = useState(driverId ?? "");
  const [formVehicle, setFormVehicle] = useState("");
  const [formFuelConsumption, setFormFuelConsumption] = useState("");
  const [formFuelPrice, setFormFuelPrice] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [selectedClients, setSelectedClients] = useState<FoundClient[]>([]);
  const [pinClient, setPinClient] = useState<FoundClient | null>(null);
  const [saving, setSaving] = useState(false);
  // Помилка живе у формі, а не в alert(): вікно браузера доводилося закривати,
  // перш ніж побачити, що саме не так.
  const [error, setError] = useState<string | null>(null);

  const toggleOrder = (id: string) =>
    setSelectedOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const pickClient = (c: FoundClient) => {
    setSelectedClients((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
    // Точки на карті немає — відкриваємо карту одразу: у списку з десяти
    // точок цей клієнт загубиться, і водій поїде його шукати по селу.
    if (pinUnusable(c)) setPinClient(c);
  };

  const dropClient = (id: string) => setSelectedClients((prev) => prev.filter((c) => c.id !== id));

  /** Пін підтверджено в карті — оновлюємо рядок тими самими координатами. */
  const applyPin = (id: string, lat: number, lng: number) =>
    setSelectedClients((prev) => prev.map((c) => (c.id === id ? { ...c, lat, lng, geoSource: "MANUAL" } : c)));

  const submit = async () => {
    setError(null);
    if (selectedOrderIds.length === 0 && selectedClients.length === 0) {
      setError("Оберіть замовлення або знайдіть клієнта в базі");
      return;
    }
    setSaving(true);
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
      if (!res.ok) setError(data.error || "Не вдалося створити маршрут");
      else onCreated(data.id);
    } catch {
      setError("Немає зв'язку — спробуйте ще раз");
    }
    setSaving(false);
  };

  const total = selectedOrderIds.length + selectedClients.length;

  return (
    <Card className="mb-4">
      <CardHeader title="Новий маршрут" />

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-[13px] text-g500">Дата</label>
          <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className="mb-1 block text-[13px] text-g500">Водій</label>
          <select
            value={formDriverId}
            onChange={(e) => setFormDriverId(e.target.value)}
            className={`${FIELD} cursor-pointer`}
          >
            <option value="">Не призначений</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[13px] text-g500">Транспорт</label>
          <input
            value={formVehicle}
            onChange={(e) => setFormVehicle(e.target.value)}
            placeholder="Напр: Renault Kangoo"
            className={FIELD}
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-[13px] text-g500">Витрата (л/100км)</label>
          <input
            type="number"
            step="0.1"
            value={formFuelConsumption}
            onChange={(e) => setFormFuelConsumption(e.target.value)}
            placeholder="8.5"
            className={FIELD}
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] text-g500">Ціна палива (грн/л)</label>
          <input
            type="number"
            step="0.01"
            value={formFuelPrice}
            onChange={(e) => setFormFuelPrice(e.target.value)}
            placeholder="54.90"
            className={FIELD}
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] text-g500">Примітка</label>
          <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className={FIELD} />
        </div>
      </div>

      <h3 className="mb-2 text-sm font-semibold text-g500">Клієнти з бази {selectedClients.length > 0 && `(${selectedClients.length})`}</h3>

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
                  <p className="truncate text-[12px] text-g500">{c.address || "адреси в картці немає"}</p>
                </div>
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
                  {pin.label}
                </button>
                <button
                  type="button"
                  onClick={() => dropClient(c.id)}
                  title="Прибрати з маршруту"
                  aria-label={`Прибрати ${c.name}`}
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
          autoFocus
          onPick={pickClient}
          pickedIds={selectedClients.map((c) => c.id)}
          onFixPin={(c) => setPinClient(c)}
        />
      </div>

      <h3 className="mb-2 text-sm font-semibold text-g500">Підтверджені замовлення ({freeOrders.length})</h3>
      {freeOrders.length === 0 ? (
        <p className="py-2 text-[13px] text-g400">Вільних підтверджених замовлень немає</p>
      ) : (
        <div className="mb-4 max-h-60 space-y-2 overflow-auto rounded-[var(--radius-btn)] border border-g200 p-2">
          {freeOrders.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-btn)] p-2 transition-colors hover:bg-g50"
            >
              <input
                type="checkbox"
                checked={selectedOrderIds.includes(o.id)}
                onChange={() => toggleOrder(o.id)}
                className="h-[18px] w-[18px] cursor-pointer accent-primary"
              />
              <div className="flex-1">
                <span className="text-sm font-semibold text-bk">{o.number}</span>
                <span className="ml-2 text-[13px] text-g500">{o.counterparty?.name || "—"}</span>
              </div>
              <span className="text-sm font-semibold tabular-nums text-bk">{formatPrice(o.totalAmount)}</span>
            </label>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={saving || total === 0}
          className="min-h-[44px] cursor-pointer rounded-[var(--radius-btn)] bg-primary px-6 text-[15px] font-bold text-bk transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Створюю…" : `Створити маршрут (${total} точок)`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-6 text-[15px] text-g600 transition-colors hover:bg-g50"
        >
          Скасувати
        </button>
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
    </Card>
  );
}
