/**
 * Місця торгового, які не є магазинами клієнтів: дім і склад.
 *
 * Стоянка вдома чи на складі нічого не каже про клієнта. У треку таких
 * стоянок багато, і вони вміють «перемагати» в голосуванні за точку
 * клієнта: замовлення, добите ввечері вдома, голосує за кухню торгового.
 *
 * Дім — і з довідника (SalesVehicle.base*), і вивчений з ранків треку:
 * довідник буває застарілим, трек — порожнім.
 */

import { prisma } from "@/lib/prisma";
import { learnHomeBases } from "@/lib/track/home-base";

export type RepPlace = { lat: number; lng: number; label: string };

export async function repPlaces(userIds: string[]): Promise<Map<string, RepPlace[]>> {
  const ids = [...new Set(userIds)];
  const [learned, saved, depots] = await Promise.all([
    ids.length ? learnHomeBases(ids) : Promise.resolve(new Map()),
    prisma.salesVehicle.findMany({
      where: { repId: { in: ids }, baseLat: { not: null }, baseLng: { not: null } },
      select: { repId: true, baseLat: true, baseLng: true },
    }),
    prisma.stockLocation.findMany({
      where: { lat: { not: null }, lng: { not: null } },
      select: { name: true, lat: true, lng: true },
    }),
  ]);

  const out = new Map<string, RepPlace[]>();
  for (const id of ids) {
    const places: RepPlace[] = [];
    const l = learned.get(id);
    if (l) places.push({ lat: l.lat, lng: l.lng, label: "дім (з ранків треку)" });
    for (const v of saved) {
      if (v.repId === id) places.push({ lat: v.baseLat!, lng: v.baseLng!, label: "база з довідника" });
    }
    for (const d of depots) places.push({ lat: d.lat!, lng: d.lng!, label: d.name });
    out.set(id, places);
  }
  return out;
}
