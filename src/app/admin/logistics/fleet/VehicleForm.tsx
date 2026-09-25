/**
 * Картка машини у формі: створення і правка одним компонентом.
 *
 * Амортизація в тій самій формі, але окремим блоком: без ціни й строку вона
 * просто не рахується, і людина бачить, чого бракує.
 */

import { useState } from "react";
import { BTN_GHOST, BTN_PRIMARY, Field, INPUT, send, todayKyiv, type FleetVehicle } from "./ui";

type Form = Record<
  | "plate" | "make" | "model" | "year" | "vin" | "fuelType" | "notes"
  | "odometerKm" | "odometerDay"
  | "purchasePrice" | "purchaseDay" | "purchaseOdometerKm" | "usefulLifeMonths" | "residualValue",
  string
>;

const s = (v: number | string | null | undefined) => (v == null ? "" : String(v));

function initial(v: FleetVehicle | null): Form {
  return {
    plate: s(v?.plate),
    make: s(v?.make),
    model: s(v?.model),
    year: s(v?.year),
    vin: s(v?.vin),
    fuelType: s(v?.fuelType),
    notes: s(v?.notes),
    odometerKm: s(v?.manualOdometer.km),
    odometerDay: v?.manualOdometer.day ?? todayKyiv(),
    purchasePrice: s(v?.purchase.price),
    purchaseDay: s(v?.purchase.day),
    purchaseOdometerKm: s(v?.purchase.odometerKm),
    usefulLifeMonths: s(v?.purchase.usefulLifeMonths ?? (v ? null : 60)),
    residualValue: s(v?.purchase.residualValue),
  };
}

export function VehicleForm({
  vehicle,
  onSaved,
  onCancel,
}: {
  vehicle: FleetVehicle | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Form>(() => initial(vehicle));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, odometerKm: form.odometerKm || null };
      if (vehicle) {
        await send(`/api/admin/fleet/vehicles/${vehicle.id}`, "PATCH", body);
        onSaved(vehicle.id);
      } else {
        const res = await send("/api/admin/fleet/vehicles", "POST", body);
        onSaved(String(res.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Держномер *">
          <input className={INPUT} value={form.plate} onChange={set("plate")} placeholder="ВС1234АК" required />
        </Field>
        <Field label="Марка *">
          <input className={INPUT} value={form.make} onChange={set("make")} placeholder="Renault" required />
        </Field>
        <Field label="Модель *">
          <input className={INPUT} value={form.model} onChange={set("model")} placeholder="Kangoo" required />
        </Field>
        <Field label="Рік">
          <input className={INPUT} value={form.year} onChange={set("year")} inputMode="numeric" placeholder="2019" />
        </Field>
        <Field label="VIN">
          <input className={INPUT} value={form.vin} onChange={set("vin")} />
        </Field>
        <Field label="Пальне">
          <input className={INPUT} value={form.fuelType} onChange={set("fuelType")} placeholder="дизель" />
        </Field>
        <Field label="Пробіг зараз, км" hint="Якщо змін торгового немає — вносьте руками">
          <input className={INPUT} value={form.odometerKm} onChange={set("odometerKm")} inputMode="numeric" />
        </Field>
        <Field label="Станом на">
          <input className={INPUT} type="date" value={form.odometerDay} onChange={set("odometerDay")} />
        </Field>
      </div>

      <fieldset className="rounded-[var(--radius-card)] border border-g200 p-3">
        <legend className="px-1 text-xs font-semibold text-g600">Амортизація (прямолінійна)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Field label="Ціна купівлі, ₴">
            <input className={INPUT} value={form.purchasePrice} onChange={set("purchasePrice")} inputMode="decimal" />
          </Field>
          <Field label="Дата купівлі">
            <input className={INPUT} type="date" value={form.purchaseDay} onChange={set("purchaseDay")} />
          </Field>
          <Field label="Пробіг при купівлі, км">
            <input className={INPUT} value={form.purchaseOdometerKm} onChange={set("purchaseOdometerKm")} inputMode="numeric" />
          </Field>
          <Field label="Строк служби, міс." hint="Типово 60 (5 років)">
            <input className={INPUT} value={form.usefulLifeMonths} onChange={set("usefulLifeMonths")} inputMode="numeric" />
          </Field>
          <Field label="Ліквідаційна, ₴" hint="За скільки продасте в кінці">
            <input className={INPUT} value={form.residualValue} onChange={set("residualValue")} inputMode="decimal" />
          </Field>
        </div>
      </fieldset>

      <Field label="Нотатки">
        <textarea className={INPUT} rows={2} value={form.notes} onChange={set("notes")} />
      </Field>

      {error && <p className="text-sm text-[#B91C1C]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          {busy ? "Зберігаю…" : vehicle ? "Зберегти" : "Додати машину"}
        </button>
        <button type="button" onClick={onCancel} className={BTN_GHOST}>
          Скасувати
        </button>
      </div>
    </form>
  );
}
