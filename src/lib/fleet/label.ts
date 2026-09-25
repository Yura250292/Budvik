/**
 * Підпис авто з «Палива» (SalesVehicle.label) → марка, модель, номер.
 *
 * У «Паливі» це вільний текст: «Renault Kangoo AC1234BC», «Шкода Фабія»,
 * «ВС 1234 АК Doblo». Номер шукаємо за українським форматом (2 літери,
 * 4 цифри, 2 літери, з пробілами чи без); решта — перше слово марка, далі
 * модель. Людина все одно бачить розбір перед створенням і править.
 */

import { normalizePlate } from "./input";

const PLATE_RE = /(?:^|\s)([A-ZА-ЯІЇЄ]{2})[\s-]?(\d{4})[\s-]?([A-ZА-ЯІЇЄ]{2})(?=\s|$)/iu;

export function parseVehicleLabel(label: string | null | undefined): { make: string; model: string; plate: string | null } {
  let text = (label ?? "").replace(/\s+/g, " ").trim();
  let plate: string | null = null;
  const m = text.match(PLATE_RE);
  if (m) {
    plate = normalizePlate(`${m[1]}${m[2]}${m[3]}`);
    text = text.replace(m[0], " ").replace(/\s+/g, " ").trim();
  }
  text = text.replace(/[,;·—-]+$/g, "").trim();
  const [make = "", ...rest] = text.split(" ");
  return { make, model: rest.join(" "), plate };
}
