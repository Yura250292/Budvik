/**
 * Точки маршрутних листів — окремий потік, бо в 1С вони лежать не в листі.
 *
 * Документ.МаршрутнийЛист не має табличної частини: рядки, які менеджер
 * бачить у формі, — це реалізації з реквізитом МаршрутнийЛист. Агент віддає
 * їх окремим файлом, кожна несе посилання на свій лист.
 *
 * ГОЛОВНЕ ТУТ — правки адміна переживають обмін.
 *
 * Прийом листів (apply-route-sheets) стирає точки цілком і пише заново:
 * рядок 1С не має стабільного id, тож іншого способу немає. Для цього
 * потоку так робити не можна — інакше кожна синхронізація затирала б
 * порядок, зони й ручні точки, і коригувати лист на сайті було б
 * неможливо. Тому зіставляємо за документом реалізації:
 *
 *   є в 1С і на сайті  → оновлюємо суму й адресу (це дані 1С), решту не чіпаємо;
 *   є в 1С, немає у нас → додаємо в кінець;
 *   немає в 1С, є у нас → лишаємо, якщо manual (додав адмін), інакше прибираємо;
 *   hidden               → не воскрешаємо: прибрану руками точку обмін
 *                          привозив би назад щодня.
 *
 * Порядок (sequence) 1С не зберігає взагалі — тільки склад. Тому послідовність
 * повністю наша, і переставляти точки на сайті безпечно.
 */

import { prisma } from "@/lib/prisma";
import type { RouteSheetStopArrival } from "./types";
import { ApplyContext } from "./context";

/** Пусте посилання 1С серіалізується в нульовий GUID — це не значення. */
function isEmptyRef(value: string | undefined): boolean {
  if (!value) return true;
  return /^\{?[0-9a-fA-F-]*0{8}-0{4}-0{4}-0{4}-0{12}/.test(value);
}

function num(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function applyRouteSheetStops(
  records: RouteSheetStopArrival[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  // Групуємо за листом: агент віддає точки пласким списком, бо читає їх
  // одним запитом по реалізаціях за період.
  const bySheet = new Map<string, RouteSheetStopArrival[]>();
  for (const rec of records) {
    if (isEmptyRef(rec.routeSheetExternalId)) continue;
    const list = bySheet.get(rec.routeSheetExternalId);
    if (list) list.push(rec);
    else bySheet.set(rec.routeSheetExternalId, [rec]);
  }
  if (bySheet.size === 0) return;

  // Prefetch одним запитом на батч: інакше 500 точок дали б тисячі пошуків.
  const counterpartyRefs = new Set<string>();
  const docRefs = new Set<string>();
  for (const rec of records) {
    if (!isEmptyRef(rec.counterpartyExternalId)) counterpartyRefs.add(rec.counterpartyExternalId!);
    if (!isEmptyRef(rec.salesDocExternalId)) docRefs.add(rec.salesDocExternalId!);
  }

  const [sheets, counterparties, documents] = await Promise.all([
    prisma.routeSheet.findMany({
      where: { externalId: { in: [...bySheet.keys()] } },
      select: { id: true, externalId: true, number: true },
    }),
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
  ]);

  const sheetByExternal = new Map(sheets.map((s) => [s.externalId, s]));
  const counterpartyByExternal = new Map(counterparties.map((c) => [c.externalId!, c.id]));
  const docByExternal = new Map(documents.map((d) => [d.externalId!, d.id]));

  for (const [sheetExternalId, arrivals] of bySheet) {
    const sheet = sheetByExternal.get(sheetExternalId);
    // Лист ще не приїхав — точки чекають наступного циклу. Не помилка:
    // шапки й точки читаються різними запитами, і лист може бути поза
    // періодом (лист від 13.08 несе відвантаження 12.08).
    if (!sheet) continue;

    const label = `Точки листа ${sheet.number}`;

    try {
      const existing = await prisma.routeSheetStop.findMany({
        where: { routeSheetId: sheet.id },
        select: {
          id: true,
          salesDocumentId: true,
          manual: true,
          hidden: true,
          sequence: true,
        },
      });

      // Ключ зіставлення — документ реалізації: він стабільний між обмінами,
      // на відміну від порядкового номера рядка.
      const existingByDoc = new Map<string, (typeof existing)[number]>();
      for (const row of existing) {
        if (row.salesDocumentId) existingByDoc.set(row.salesDocumentId, row);
      }

      const seenIds = new Set<string>();
      const toCreate: {
        routeSheetId: string;
        sequence: number;
        counterpartyId: string | null;
        salesDocumentId: string | null;
        address: string | null;
        amount: number;
      }[] = [];
      const toUpdate: { id: string; address: string | null; amount: number }[] = [];

      let nextSequence = existing.reduce((max, r) => Math.max(max, r.sequence), 0);

      for (const arrival of arrivals) {
        const docId = isEmptyRef(arrival.salesDocExternalId)
          ? null
          : (docByExternal.get(arrival.salesDocExternalId!) ?? null);
        const counterpartyId = isEmptyRef(arrival.counterpartyExternalId)
          ? null
          : (counterpartyByExternal.get(arrival.counterpartyExternalId!) ?? null);
        const address = arrival.address?.trim() || null;
        const amount = num(arrival.amount);

        const match = docId ? existingByDoc.get(docId) : undefined;

        if (match) {
          seenIds.add(match.id);
          // Приховану точку не воскрешаємо: адмін прибрав її свідомо, а
          // реалізація в 1С нікуди не зникне й привозила б її щодня.
          if (match.hidden) continue;
          // Оновлюємо тільки те, що належить 1С. Порядок, зона й ручна
          // оплата лишаються як їх виставив адмін.
          toUpdate.push({ id: match.id, address, amount });
        } else {
          toCreate.push({
            routeSheetId: sheet.id,
            sequence: ++nextSequence,
            counterpartyId,
            salesDocumentId: docId,
            address,
            amount,
          });
        }
      }

      // Точки, яких у 1С більше немає: реалізацію перепровели на інший лист
      // або видалили. Ручні лишаємо — їх у 1С ніколи й не було.
      const stale = existing
        .filter((row) => !seenIds.has(row.id) && !row.manual)
        .map((row) => row.id);

      await prisma.$transaction([
        ...toUpdate.map((u) =>
          prisma.routeSheetStop.update({
            where: { id: u.id },
            data: { address: u.address, amount: u.amount },
          })
        ),
        ...(toCreate.length > 0
          ? [prisma.routeSheetStop.createMany({ data: toCreate })]
          : []),
        ...(stale.length > 0
          ? [prisma.routeSheetStop.deleteMany({ where: { id: { in: stale } } })]
          : []),
      ]);

      ctx.updated++;
    } catch (e) {
      ctx.fail(label, e);
    }
  }
}
