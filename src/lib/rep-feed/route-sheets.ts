/**
 * «Поїде завтра»: накладна клієнта торгового потрапила в маршрутний лист.
 *
 * «Коли приїде товар» — найчастіше питання клієнта до торгового, а торговий
 * несе його в офіс. Маршрутні листи з 1С уже на сайті (канал route_sheet),
 * і їхні рядки прив'язані до накладних майже завжди. Водій у листі
 * заповнений рідко — тоді його просто немає в тексті.
 *
 * Рядки листа обмін перезаписує цілком на кожному циклі, тож id рядка
 * нестабільний. Ключ події — зовнішній id листа + накладна: та сама
 * накладна, перенесена в лист на інший день, — нова подія.
 *
 * Модуль без next/*: воркер.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { resolveReps } from "./events";
import { describeRoute } from "./format";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

/** Накладна старша за стільки днів у листі — це архів, не новина. */
const DOC_MAX_AGE_DAYS = 10;
const DAY_MS = 24 * 60 * 60_000;

export function routeDedupKey(sheetExternalId: string, docId: string): string {
  return `${REP_FEED_TYPES.ROUTE}:${sheetExternalId}:${docId}`;
}

export async function collectRouteSheetEvents(now: Date): Promise<FeedEvent[]> {
  const today = kyivDate(now);
  const sheets = await prisma.routeSheet.findMany({
    where: { posted: true, date: { gte: new Date(`${today}T00:00:00.000Z`) } },
    select: {
      externalId: true,
      number: true,
      date: true,
      driverName1C: true,
      driver: { select: { name: true } },
      stops: {
        where: { hidden: false, salesDocumentId: { not: null } },
        select: {
          salesDocument: {
            select: {
              id: true,
              number: true,
              totalAmount: true,
              salesRepId: true,
              counterpartyId: true,
              createdAt: true,
              status: true,
              counterparty: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const docFloor = new Date(`${today}T00:00:00.000Z`).getTime() - DOC_MAX_AGE_DAYS * DAY_MS;
  const rows = sheets.flatMap((sheet) =>
    sheet.stops.flatMap((st) =>
      st.salesDocument && st.salesDocument.status !== "CANCELLED" && st.salesDocument.createdAt.getTime() >= docFloor
        ? [{ sheet, doc: st.salesDocument }]
        : []
    )
  );
  if (rows.length === 0) return [];

  const known = new Set(
    (
      await prisma.notification.findMany({
        where: { dedupKey: { in: rows.map((r) => routeDedupKey(r.sheet.externalId, r.doc.id)) } },
        select: { dedupKey: true },
      })
    ).map((n) => n.dedupKey)
  );
  const todo = rows.filter((r) => !known.has(routeDedupKey(r.sheet.externalId, r.doc.id)));
  if (todo.length === 0) return [];

  const repFor = await resolveReps(todo.map((r) => r.doc));
  const events: FeedEvent[] = [];
  const seen = new Set<string>();

  for (const { sheet, doc } of todo) {
    const repId = repFor(doc);
    const key = routeDedupKey(sheet.externalId, doc.id);
    if (!repId || seen.has(key)) continue;
    seen.add(key);
    events.push({
      type: REP_FEED_TYPES.ROUTE,
      repId,
      dedupKey: key,
      relatedId: doc.id,
      target: `/sales/orders/${doc.id}`,
      ...describeRoute({
        name: doc.counterparty?.name,
        number: doc.number,
        amount: doc.totalAmount,
        day: sheet.date.toISOString().slice(0, 10),
        today,
        driver: (sheet.driver?.name ?? sheet.driverName1C)?.trim() || null,
        sheetNumber: sheet.number,
      }),
      at: now,
    });
  }
  return events;
}
