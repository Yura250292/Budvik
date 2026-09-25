import { kyivDayStart } from "@/lib/date/kyiv";
import { FleetInputError, normalizePlate, optDay, optNum, optText, reqText } from "@/lib/fleet/input";

/**
 * Поля машини з тіла запиту — для створення (усі) і правки (лише передані).
 *
 * При правці undefined означає «не чіпати», а null чи порожній рядок —
 * «очистити»: інакше збереження одного поля стирало б сусідні.
 */
export function vehicleData(body: Record<string, unknown>, today: string, partial: boolean) {
  const has = (k: string) => !partial || k in body;
  const out: Record<string, unknown> = {};

  if (has("plate")) {
    const raw = optText(body.plate, "Номер", 20);
    const plate = raw ? normalizePlate(raw) : null;
    if (plate && plate.length < 4) throw new FleetInputError("Номер закороткий");
    out.plate = plate;
  }
  if (has("ownership")) {
    if (body.ownership !== "COMPANY" && body.ownership !== "PERSONAL") {
      throw new FleetInputError("Вкажіть, чия машина: фірми чи торгового");
    }
    out.ownership = body.ownership;
  }
  if (has("make")) out.make = reqText(body.make, "Марка", 60);
  if (has("model")) out.model = reqText(body.model, "Модель", 60);
  if (has("year")) out.year = optNum(body.year, "Рік", { min: 1980, max: Number(today.slice(0, 4)) + 1, int: true });
  if (has("vin")) out.vin = optText(body.vin, "VIN", 20)?.toUpperCase() ?? null;
  if (has("fuelType")) out.fuelType = optText(body.fuelType, "Пальне", 40);
  if (has("notes")) out.notes = optText(body.notes, "Нотатки", 1000);
  if (partial && "active" in body) out.active = body.active === true;

  // Ручне показання одометра: дата без числа нічого не значить, і навпаки.
  if (has("odometerKm")) {
    const km = optNum(body.odometerKm, "Пробіг", { min: 0, max: 3_000_000, int: true });
    out.odometerKm = km;
    out.odometerAt = km == null ? null : kyivDayStart(optDay(body.odometerDay, "Дата пробігу", today) ?? today);
  }

  if (has("purchasePrice")) out.purchasePrice = optNum(body.purchasePrice, "Ціна купівлі", { min: 0, max: 100_000_000 });
  if (has("purchaseDay")) {
    const d = optDay(body.purchaseDay, "Дата купівлі", today);
    out.purchaseDate = d ? kyivDayStart(d) : null;
  }
  if (has("purchaseOdometerKm")) {
    out.purchaseOdometerKm = optNum(body.purchaseOdometerKm, "Пробіг при купівлі", { min: 0, max: 3_000_000, int: true });
  }
  if (has("usefulLifeMonths")) {
    out.usefulLifeMonths = optNum(body.usefulLifeMonths, "Строк служби, міс.", { min: 1, max: 600, int: true });
  }
  if (has("residualValue")) out.residualValue = optNum(body.residualValue, "Ліквідаційна вартість", { min: 0, max: 100_000_000 });

  const price = out.purchasePrice as number | null | undefined;
  const residual = out.residualValue as number | null | undefined;
  if (price != null && residual != null && residual > price) {
    throw new FleetInputError("Ліквідаційна вартість не може бути більшою за ціну купівлі");
  }
  return out;
}
