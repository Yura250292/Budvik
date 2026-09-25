import { kyivDayStart } from "@/lib/date/kyiv";
import { isKind } from "@/lib/fleet/kinds";
import { FleetInputError, optNum, optText, reqDay, reqText } from "@/lib/fleet/input";

/** Поля запису журналу. При правці — лише передані (див. vehicle-data.ts). */
export function serviceData(body: Record<string, unknown>, today: string, partial: boolean) {
  const has = (k: string) => !partial || k in body;
  const out: Record<string, unknown> = {};

  if (has("day")) out.date = kyivDayStart(reqDay(body.day, "Дата", today));
  if (has("kind")) {
    if (!isKind(body.kind)) throw new FleetInputError("Виберіть вид робіт");
    out.kind = body.kind;
  }
  if (has("title")) out.title = reqText(body.title, "Що зроблено", 300);
  if (has("odometerKm")) out.odometerKm = optNum(body.odometerKm, "Пробіг", { min: 0, max: 3_000_000, int: true });
  if (has("partsCost")) out.partsCost = optNum(body.partsCost, "Запчастини, ₴", { min: 0, max: 10_000_000 }) ?? 0;
  if (has("laborCost")) out.laborCost = optNum(body.laborCost, "Робота, ₴", { min: 0, max: 10_000_000 }) ?? 0;
  if (has("vendor")) out.vendor = optText(body.vendor, "СТО / магазин", 120);
  if (has("notes")) out.notes = optText(body.notes, "Нотатки", 1000);
  return out;
}
