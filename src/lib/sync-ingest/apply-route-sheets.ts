/**
 * Маршрутні листи з 1С — основа зарплати водіїв.
 *
 * Зіставлення тільки за externalId: маршрутний лист існує виключно як
 * сутність 1С, локальних дублів немає, тож драбина «номер → номер/рік →
 * номер/GUID» з apply-documents тут не потрібна.
 *
 * Водій приходить як Ref_Key фізособи в 1С і зіставляється з
 * User.driver1CExternalId, який адмін заповнює вручну (водіїв одиниці, а
 * автоматичне зіставлення за прізвищем коштувало б чужої зарплати). Лист із
 * незіставленим водієм зберігається з driverId = null і чекає прив'язки —
 * відкидати його не можна, інакше після прив'язки історія лишиться порожньою.
 *
 * Рядки перезаписуються цілком: у 1С рядок документа не має стабільного
 * ідентифікатора (та сама причина, що в apply-documents).
 */

import { prisma } from "@/lib/prisma";
import type { RouteSheetRecord, RouteSheetStopRecord } from "./types";
import { ApplyContext } from "./context";

/** Пусте посилання 1С серіалізується в нульовий GUID — це не значення. */
function isEmptyRef(value: string | undefined): boolean {
  if (!value) return true;
  return /^\{?[0-9a-fA-F-]*0{8}-0{4}-0{4}-0{4}-0{12}/.test(value);
}

function num(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Рядки листа з підставленими id контрагентів і документів.
 *
 * Незіставлений контрагент не втрачає рядок: адреса й суми лишаються, і
 * точка все одно оплачується — просто зону доведеться визначати за адресою,
 * а не за координатами картки.
 */
function buildStops(
  stops: RouteSheetStopRecord[],
  counterpartyByExternal: Map<string, string>,
  docByExternal: Map<string, string>
): {
  sequence: number;
  counterpartyId: string | null;
  salesDocumentId: string | null;
  address: string | null;
  amount: number;
  debtAmount: number;
}[] {
  return stops.map((stop, index) => ({
    sequence: index + 1,
    counterpartyId: isEmptyRef(stop.counterpartyExternalId)
      ? null
      : (counterpartyByExternal.get(stop.counterpartyExternalId!) ?? null),
    salesDocumentId: isEmptyRef(stop.salesDocExternalId)
      ? null
      : (docByExternal.get(stop.salesDocExternalId!) ?? null),
    address: stop.address?.trim() || null,
    amount: num(stop.amount),
    debtAmount: num(stop.debtAmount),
  }));
}

export async function applyRouteSheets(
  records: RouteSheetRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  // Prefetch одним запитом на батч: 500 листів по кілька точок кожен дали б
  // тисячі окремих пошуків контрагента.
  const counterpartyRefs = new Set<string>();
  const docRefs = new Set<string>();
  for (const record of records) {
    for (const stop of record.stops ?? []) {
      if (!isEmptyRef(stop.counterpartyExternalId)) counterpartyRefs.add(stop.counterpartyExternalId!);
      if (!isEmptyRef(stop.salesDocExternalId)) docRefs.add(stop.salesDocExternalId!);
    }
  }

  const driverRefs = new Set(
    records.map((r) => r.driverExternalId).filter((v): v is string => !isEmptyRef(v))
  );

  const [counterparties, documents, drivers] = await Promise.all([
    counterpartyRefs.size > 0
      ? prisma.counterparty.findMany({
          where: { externalId: { in: [...counterpartyRefs] } },
          select: { id: true, externalId: true },
        })
      : Promise.resolve([]),
    docRefs.size > 0
      ? prisma.salesDocument.findMany({
          where: { externalId: { in: [...docRefs] } },
          select: { id: true, externalId: true },
        })
      : Promise.resolve([]),
    driverRefs.size > 0
      ? prisma.user.findMany({
          where: { driver1CExternalId: { in: [...driverRefs] } },
          select: { id: true, driver1CExternalId: true },
        })
      : Promise.resolve([]),
  ]);

  const counterpartyByExternal = new Map(counterparties.map((c) => [c.externalId!, c.id]));
  const docByExternal = new Map(documents.map((d) => [d.externalId!, d.id]));
  const driverByExternal = new Map(drivers.map((d) => [d.driver1CExternalId!, d.id]));

  // Про незіставлених водіїв повідомляємо один раз на батч, а не на кожен
  // лист: інакше журнал розбіжностей забило б сотнями однакових рядків.
  const reportedDrivers = new Set<string>();

  for (const record of records) {
    const label = `Маршрутний лист ${record.number}`;

    try {
      const date = new Date(record.date);
      if (Number.isNaN(date.getTime())) {
        ctx.fail(label, new Error(`невалідна дата "${record.date}"`));
        continue;
      }

      const driverExternalId = isEmptyRef(record.driverExternalId)
        ? null
        : record.driverExternalId!;
      const driverId = driverExternalId ? (driverByExternal.get(driverExternalId) ?? null) : null;

      if (driverExternalId && !driverId && !reportedDrivers.has(driverExternalId)) {
        reportedDrivers.add(driverExternalId);
        ctx.discrepancy({
          entityType: "route_sheet",
          entityRef: driverExternalId,
          entityName: record.driverName ?? "водій без імені",
          field: "DRIVER_UNMAPPED",
          value1C: record.driverName ?? driverExternalId,
          valueBudvik: "акаунт водія не прив'язано",
        });
      }

      if (ctx.isPreview) {
        ctx.skipped++;
        continue;
      }

      const stops = buildStops(record.stops ?? [], counterpartyByExternal, docByExternal);

      const data = {
        number: record.number,
        date,
        posted: record.posted ?? true,
        driverName1C: record.driverName?.trim() || null,
        driverExternalId1C: driverExternalId,
        driverId,
        vehicle: record.vehicle?.trim() || null,
        distanceKm: num(record.distanceKm),
        ordersTotal: num(record.ordersTotal),
        debtsTotal: num(record.debtsTotal),
        syncedAt: new Date(),
      };

      const existing = await prisma.routeSheet.findUnique({
        where: { externalId: record.externalId },
        select: { id: true },
      });

      if (existing) {
        // Прив'язку водія, зроблену вручну, повторний обмін не зриває:
        // driverId переписуємо лише тим, що змогли розв'язати самі, а якщо
        // не змогли — лишаємо як є.
        await prisma.$transaction([
          prisma.routeSheet.update({
            where: { id: existing.id },
            data: driverId ? data : { ...data, driverId: undefined },
          }),
          prisma.routeSheetStop.deleteMany({ where: { routeSheetId: existing.id } }),
          ...(stops.length > 0
            ? [
                prisma.routeSheetStop.createMany({
                  data: stops.map((s) => ({ ...s, routeSheetId: existing.id })),
                }),
              ]
            : []),
        ]);
        ctx.updated++;
      } else {
        await prisma.routeSheet.create({
          data: {
            externalId: record.externalId,
            ...data,
            ...(stops.length > 0 ? { stops: { create: stops } } : {}),
          },
        });
        ctx.created++;
      }
    } catch (e) {
      ctx.fail(label, e);
    }
  }
}
