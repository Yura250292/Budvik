/**
 * Ручне коригування маршруту: спільні правила для всіх роутів правки.
 *
 * Тут живе те, що інакше розповзлося б по п'яти ендпоінтах і почало
 * розходитися: коли маршрут ще можна правити, як пронумерувати точки після
 * видалення, і як перевірити, що точка справді належить цьому маршруту.
 *
 * Правило редагованості одне: правити можна, поки водій не поїхав. Чернетку
 * (PLANNED) і переданий маршрут (ASSIGNED) — так; IN_PROGRESS уже виконують,
 * і зміна складу точок під водієм зробила б його чек-ліст брехливим.
 * COMPLETED і CANCELLED — історія.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart, kyivDayEnd } from "@/lib/date/kyiv";
import type { Prisma, DeliveryRouteStatus } from "@prisma/client";

/** Статуси, у яких логіст ще може міняти склад і порядок точок. */
export const EDITABLE_STATUSES: DeliveryRouteStatus[] = ["PLANNED", "ASSIGNED"];

export function isEditable(status: DeliveryRouteStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** Людський текст відмови — його побачить логіст у тості. */
export function notEditableReason(status: DeliveryRouteStatus): string {
  if (status === "IN_PROGRESS") {
    return "Водій уже в дорозі — маршрут правити пізно. Спершу скасуйте або дочекайтеся завершення.";
  }
  if (status === "COMPLETED") return "Маршрут завершено — це вже історія.";
  if (status === "CANCELLED") return "Маршрут скасовано.";
  return "Маршрут не можна редагувати.";
}

/**
 * Перенумеровує точки маршруту підряд, 1..N, зберігаючи поточний порядок.
 *
 * Потрібне після кожного видалення: інакше в нумерації лишаються діри
 * (1, 2, 4), і водій на планшеті бачить «точка 4 з 3».
 */
export async function resequence(
  tx: Prisma.TransactionClient,
  routeId: string
): Promise<void> {
  const stops = await tx.deliveryStop.findMany({
    where: { deliveryRouteId: routeId },
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  for (let i = 0; i < stops.length; i++) {
    await tx.deliveryStop.update({
      where: { id: stops[i].id },
      data: { sequence: i + 1 },
    });
  }
}

/**
 * Маршрут для правки: знаходить, перевіряє статус.
 *
 * Повертає або маршрут, або готову причину відмови зі статусом HTTP —
 * викликаючий роут просто віддає її як є.
 */
export async function loadEditableRoute(
  routeId: string
): Promise<
  | { ok: true; route: { id: string; status: DeliveryRouteStatus; driverId: string | null; date: Date } }
  | { ok: false; error: string; status: number }
> {
  const route = await prisma.deliveryRoute.findUnique({
    where: { id: routeId },
    select: { id: true, status: true, driverId: true, date: true },
  });

  if (!route) return { ok: false, error: "Маршрут не знайдено", status: 404 };
  if (!isEditable(route.status)) {
    return { ok: false, error: notEditableReason(route.status), status: 400 };
  }
  return { ok: true, route };
}

/**
 * Чи є в цього водія на цю дату інший активний маршрут.
 *
 * Причина перевірки не косметична: resolveDriverDay бере ОДИН маршрут
 * (findFirst за createdAt desc), тому другий маршрут дня водій просто не
 * побачив би. А зарплата рахує обидва — і за день нарахувалися б дві ставки
 * за пробіг. Тому передати другий маршрут на ту саму дату можна лише
 * свідомо, з підтвердженням.
 */
export async function findDayConflict(
  driverId: string,
  date: Date,
  exceptRouteId: string
): Promise<{ id: string; number: string } | null> {
  const day = kyivDate(date);

  return prisma.deliveryRoute.findFirst({
    where: {
      driverId,
      id: { not: exceptRouteId },
      date: { gte: kyivDayStart(day), lte: kyivDayEnd(day) },
      status: { in: ["ASSIGNED", "IN_PROGRESS"] },
    },
    select: { id: true, number: true },
  });
}
