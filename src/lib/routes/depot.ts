/**
 * Склад, з якого виїжджає розвозка.
 *
 * Одне місце на весь код, і це не косметика. Точку старту питали двоє —
 * оптимізатор логіста і дорога водія, — і питали по-різному: перший брав
 * будь-який активний склад із координатами, тобто міг вибрати «брак» або
 * «майстерню» (isService), і рахувати обʼїзд від них. Помилка тиха:
 * маршрут виходить правдоподібний, просто на кілька кілометрів довший,
 * і ніхто не питає чому.
 *
 * isDefault першим — це основний склад; за ним алфавіт, щоб вибір не
 * залежав від порядку рядків у базі.
 *
 * null — складу з координатами немає взагалі. Це нормальна відповідь, а не
 * помилка: викликач сам вирішує, що робити (стартувати з першої точки або
 * не малювати подачу).
 */

import { prisma } from "@/lib/prisma";

export type Depot = { lat: number; lng: number; name: string };

export async function defaultDepot(): Promise<Depot | null> {
  const row = await prisma.stockLocation.findFirst({
    where: {
      isActive: true,
      // Службовий склад (брак, майстерня, обмінний фонд) розвозку не
      // відвантажує — стартувати від нього означає рахувати чужу дорогу.
      isService: false,
      lat: { not: null },
      lng: { not: null },
    },
    select: { lat: true, lng: true, name: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  if (row?.lat == null || row?.lng == null) return null;
  return { lat: row.lat, lng: row.lng, name: row.name };
}
