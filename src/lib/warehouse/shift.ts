/**
 * Зміна складовщика: прийшов на склад — пішов зі складу.
 *
 * Це НЕ зміна торгового (модель Shift): там одометр, каса, маршрут і звірка
 * пробігу, а тут — час і місце. Моделі свідомо різні, і змішувати їх не
 * можна: половина колонок стояла б вічно порожньою (див. коментар над
 * SalesTrip у схемі).
 *
 * Логіка та сама, що в боті (budvik-sklad-bot/src/shifts.js) — застосунок і
 * бот мусять давати офісу однакову картину, поки живі обидва входи.
 */

import type { WarehouseShift } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reverseGeocode } from "@/lib/geo/nominatim";

export async function getOpenShift(userId: string): Promise<WarehouseShift | null> {
  return prisma.warehouseShift.findFirst({
    where: { userId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });
}

/**
 * Адреса — необов'язкова.
 *
 * Nominatim публічний і має стелю запитів; на складі без зв'язку його може
 * не бути взагалі. Зміна від цього не залежить: координати вже записані, а
 * адресу офіс завжди прочитає з них. Впасти тут означало б не пустити людину
 * на роботу через чужий сервіс.
 */
async function addressFor(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return { short: null, full: null };
  const geo = await reverseGeocode(lat, lng).catch(() => null);
  return { short: geo?.shortName ?? null, full: geo?.displayName ?? null };
}

export async function openShift(
  userId: string,
  lat: number | null,
  lng: number | null
): Promise<WarehouseShift> {
  const addr = await addressFor(lat, lng);

  return prisma.warehouseShift.create({
    data: {
      userId,
      status: "OPEN",
      openLat: lat,
      openLng: lng,
      openAddress: addr.short,
      openAddressFull: addr.full,
    },
  });
}

export async function closeShift(
  shift: WarehouseShift,
  lat: number | null,
  lng: number | null
): Promise<WarehouseShift> {
  const addr = await addressFor(lat, lng);

  const closedAt = new Date();
  const durationMinutes = Math.max(
    0,
    Math.round((closedAt.getTime() - new Date(shift.openedAt).getTime()) / 60000)
  );

  return prisma.warehouseShift.update({
    where: { id: shift.id },
    data: {
      status: "CLOSED",
      closedAt,
      closeLat: lat,
      closeLng: lng,
      closeAddress: addr.short,
      closeAddressFull: addr.full,
      durationMinutes,
    },
  });
}

/** Скільки накладних приїхало за зміну — показуємо при закритті. */
export async function shiftSummary(shiftId: string) {
  const reports = await prisma.warehouseReport.findMany({
    where: { shiftId },
    select: { totalAmount: true, status: true },
  });

  const done = reports.filter((r) => r.status === "DONE");
  return {
    reportsCount: reports.length,
    doneCount: done.length,
    pendingCount: reports.filter((r) => r.status === "PENDING" || r.status === "PROCESSING").length,
    totalAmount: done.reduce((sum, r) => sum + (r.totalAmount || 0), 0),
  };
}

export function shiftDto(shift: WarehouseShift | null) {
  if (!shift) return null;
  return {
    id: shift.id,
    status: shift.status,
    openedAt: shift.openedAt,
    openAddress: shift.openAddress,
    closedAt: shift.closedAt,
    closeAddress: shift.closeAddress,
    durationMinutes: shift.durationMinutes,
  };
}
