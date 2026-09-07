/**
 * Інструменти складського помічника.
 *
 * Питання складовщика інші, ніж у торгового й водія, і саме тому вони тут
 * окремо. Він не продає й нікуди не їде — він приймає товар, збирає
 * замовлення й віддає його водієві. Тому його два головні питання:
 *
 * — «де водій і що він везе» (можна вже вантажити? чи повернувся?);
 * — «що я сьогодні здав» (чи всі накладні доїхали в офіс).
 *
 * Решту — картку клієнта, залишок товару, нагадування — він бере тими самими
 * інструментами, що й уся команда: дублювати їх заради ролі означало б два
 * набори правди про того самого клієнта.
 *
 * Усе ТІЛЬКИ читання.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { day as validDay } from "@/lib/assistant/validate";
import { prisma } from "@/lib/prisma";
import { kyivDayStart, kyivDayEnd } from "@/lib/date/kyiv";
import { uah } from "@/lib/assistant/format";
import { driverDayFacts } from "@/lib/assistant/facts/driver-day";

/** Скільки хвилин тому востаннє озвався планшет. */
function minutesAgo(at: Date | null): number | null {
  if (!at) return null;
  return Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
}

function hhmm(at: Date | null): string | null {
  if (!at) return null;
  return at.toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Номери накладних по клієнтах — лише для маршрутів, спланованих на сайті.
 *
 * У маршрутному листі 1С документа немає взагалі: лист — це шапка, а точки
 * беруться з друкованої форми (див. 1c-no-transport-subsystem). Тому номер
 * тут може бути порожній, і це не поломка — так і треба сказати людині,
 * замість того щоб вигадати номер.
 */
async function docNumbersByClient(driverId: string, dayStart: Date, dayEnd: Date) {
  const stops = await prisma.deliveryStop.findMany({
    where: {
      counterpartyId: { not: null },
      salesDocumentId: { not: null },
      deliveryRoute: { driverId, date: { gte: dayStart, lte: dayEnd } },
    },
    select: { counterpartyId: true, salesDocument: { select: { number: true } } },
  });

  const map = new Map<string, string[]>();
  for (const s of stops) {
    if (!s.counterpartyId || !s.salesDocument?.number) continue;
    const list = map.get(s.counterpartyId) ?? [];
    list.push(s.salesDocument.number);
    map.set(s.counterpartyId, list);
  }
  return map;
}

export const driversTodayTool: ToolDef = {
  name: "drivers_today",
  label: "Дивлюся, де водії",
  kinds: ["WAREHOUSE"],
  description:
    "Хто з водіїв сьогодні в дорозі: маршрут, точки по порядку з клієнтами, сумами й номерами накладних, скільки вже відмічено, скільки грошей забрати, і коли востаннє озвався планшет. Викликай на будь-яке питання про водіїв, доставку, «де зараз», «що везе», «чи повернувся».",
  parameters: {
    type: "object",
    properties: {
      dayIso: { type: "string", description: "День у форматі 2026-09-07. За замовчуванням — сьогодні." },
      driverName: { type: "string", description: "Частина імені водія, якщо питають про конкретного." },
    },
  },
  async run(ctx, args) {
    const target = validDay(args.dayIso, "dayIso", ctx.today);
    const dayStart = kyivDayStart(target);
    const dayEnd = kyivDayEnd(target);
    const needle = typeof args.driverName === "string" ? args.driverName.trim().toLowerCase() : "";

    const drivers = await prisma.user.findMany({
      where: { role: "DRIVER" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const wanted = needle
      ? drivers.filter((d) => (d.name ?? "").toLowerCase().includes(needle))
      : drivers;

    if (wanted.length === 0) {
      return { день: target, водії: [], примітка: needle ? "Водія з таким іменем немає" : "Водіїв немає" };
    }

    const rows = await Promise.all(
      wanted.map(async (d) => {
        /**
         * Візити читаємо окремо, хоч `driverDayFacts` уже рахує `done`.
         *
         * Складовщикові мало «зроблено / не зроблено»: точка, яку водій
         * позначив як невдалу (MISSED), — це товар, що ЇДЕ НАЗАД на склад,
         * і саме його треба приймати. Прапорець `done` цього не розрізняє.
         */
        const [facts, visits, session, docs] = await Promise.all([
          driverDayFacts(d.id, target),
          prisma.visit.findMany({
            where: { userId: d.id, day: dayStart },
            select: { counterpartyId: true, status: true, collectedAmount: true },
          }),
          prisma.trackSession.findUnique({
            where: { userId_day: { userId: d.id, day: dayStart } },
            select: { lastPointAt: true, distanceKm: true, pointsCount: true },
          }),
          docNumbersByClient(d.id, dayStart, dayEnd),
        ]);

        const doneBy = new Map(visits.map((v) => [v.counterpartyId, v.status]));
        const stops = facts.stops.map((s) => {
          const mark = s.counterpartyId ? doneBy.get(s.counterpartyId) : undefined;
          return {
            порядок: s.seq,
            клієнт_id: s.counterpartyId,
            назва: s.name,
            адреса: s.address,
            накладні: s.counterpartyId ? (docs.get(s.counterpartyId) ?? []) : [],
            товару_на: uah(s.amount),
            забрати_грошей: uah(s.debt),
            вид: s.kind === "DELIVERY" ? "доставка" : s.kind === "PICKUP" ? "забрати" : "доручення",
            стан: mark === "DONE" ? "відмічено" : mark === "MISSED" ? "не вийшло" : "чекає",
            примітка: s.notes,
          };
        });

        const done = stops.filter((s) => s.стан === "відмічено").length;
        const next = stops.find((s) => s.стан === "чекає") ?? null;

        return {
          водій: d.name,
          маршрут: {
            джерело:
              facts.route.source === "ROUTE_SHEET"
                ? "маршрутний лист 1С"
                : facts.route.source === "DELIVERY_ROUTE"
                  ? "маршрут із сайту"
                  : "маршруту немає",
            номер: facts.route.number,
            авто: facts.route.vehicle,
          },
          разом: {
            точок: stops.length,
            відмічено: done,
            лишилось: stops.length - done,
            товару_на: uah(facts.totals.amount),
            забрати_грошей: uah(facts.totals.debt),
          },
          /**
           * «Де зараз» — це не координати, а наступна точка й час останнього
           * сигналу: складовщикові треба знати, чи їде людина й коли буде,
           * а не широту з довготою.
           */
          зараз: {
            наступна_точка: next ? { назва: next.назва, адреса: next.адреса } : null,
            останній_сигнал: hhmm(session?.lastPointAt ?? null),
            хвилин_тому: minutesAgo(session?.lastPointAt ?? null),
            пройдено_км: session?.distanceKm != null ? Math.round(session.distanceKm) : null,
          },
          каса: {
            зібрано: uah(facts.cash.collected),
            здано: uah(facts.cash.handed),
            на_руках: uah(facts.cash.onHands),
          },
          точки: stops,
        };
      })
    );

    return { день: target, водії: rows };
  },
};

const PACK_STATE: Record<string, string> = {
  CONFIRMED: "до збірки",
  PACKING: "пакується",
  IN_TRANSIT: "відправлено",
};

const DELIVERY_LABEL: Record<string, string> = {
  DRIVER: "везе водій",
  SALES_REP_PICKUP: "забере торговий",
  SELF_PICKUP: "самовивіз",
};

export const ordersToPackTool: ToolDef = {
  name: "orders_to_pack",
  label: "Дивлюся замовлення на збірку",
  kinds: ["WAREHOUSE"],
  description:
    "Замовлення, які зараз на складі: до збірки, в упакуванні та вже відправлені. Номер, клієнт, торговий, кількість позицій, сума, спосіб доставки. Викликай на питання «що пакувати», «скільки замовлень», «чи є замовлення на …».",
  parameters: {
    type: "object",
    properties: {
      state: {
        type: "string",
        enum: ["to_pack", "packing", "sent", "all"],
        description:
          "Що показати: to_pack — підтверджені й не взяті в роботу, packing — в упакуванні, sent — відправлені, all — усі три. За замовчуванням all.",
      },
      client: { type: "string", description: "Частина назви клієнта, якщо питають про конкретного." },
    },
  },
  async run(_ctx, args) {
    const state = typeof args.state === "string" ? args.state : "all";
    const statuses =
      state === "to_pack"
        ? ["CONFIRMED"]
        : state === "packing"
          ? ["PACKING"]
          : state === "sent"
            ? ["IN_TRANSIT"]
            : ["CONFIRMED", "PACKING", "IN_TRANSIT"];

    const client = typeof args.client === "string" ? args.client.trim() : "";

    const docs = await prisma.salesDocument.findMany({
      where: {
        docType: "ORDER",
        status: { in: statuses as never },
        ...(client ? { counterparty: { name: { contains: client, mode: "insensitive" } } } : {}),
      },
      select: {
        number: true,
        status: true,
        totalAmount: true,
        deliveryMethod: true,
        createdAt: true,
        notes: true,
        counterparty: { select: { id: true, name: true } },
        salesRep: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      // Стеля: далі першого екрана в такому списку не читає ніхто, а
      // сотня документів у відповіді з'їла б контекст ходу.
      take: 60,
    });

    /**
     * Підсумки рахуємо ЗАПИТОМ, а не по вибраній сторінці.
     *
     * Перша версія рахувала їх по тих 60 рядках, що приїхали, — і на питання
     * «скільки замовлень до збірки» помічник упевнено відповідав «59», коли
     * насправді їх 3410. Число, яке залежить від стелі вибірки, гірше за
     * відсутнє: воно виглядає точним.
     */
    const totals = await prisma.salesDocument.groupBy({
      by: ["status"],
      where: {
        docType: "ORDER",
        status: { in: statuses as never },
        ...(client ? { counterparty: { name: { contains: client, mode: "insensitive" } } } : {}),
      },
      _count: true,
      _sum: { totalAmount: true },
    });

    const byState = (s: string) => totals.find((t) => t.status === s)?._count ?? 0;

    return {
      разом: {
        до_збірки: byState("CONFIRMED"),
        пакується: byState("PACKING"),
        відправлено: byState("IN_TRANSIT"),
        на_суму: uah(totals.reduce((sum, t) => sum + (t._sum.totalAmount ?? 0), 0)),
        /** Скільки з них показано нижче — щоб модель не видавала сторінку за все. */
        показано: docs.length,
      },
      замовлення: docs.map((d) => ({
        номер: d.number,
        стан: PACK_STATE[d.status] ?? d.status,
        клієнт_id: d.counterparty?.id ?? null,
        клієнт: d.counterparty?.name ?? "—",
        торговий: d.salesRep?.name ?? null,
        позицій: d._count.items,
        сума: uah(d.totalAmount),
        доставка: d.deliveryMethod ? (DELIVERY_LABEL[d.deliveryMethod] ?? null) : null,
        коментар: d.notes,
      })),
    };
  },
};

const REPORT_STATE: Record<string, string> = {
  DONE: "прочитано",
  PENDING: "читається",
  PROCESSING: "читається",
  FAILED: "не вийшло",
};

export const myInvoicesTool: ToolDef = {
  name: "my_invoices",
  label: "Дивлюся мої накладні",
  kinds: ["WAREHOUSE"],
  description:
    "Накладні, які цей складовщик відсканував за день: номер, контрагент, кількість позицій, сума, і чи прочиталися вони. Викликай на питання «що я сьогодні здав», «скільки накладних», «які не пройшли».",
  parameters: {
    type: "object",
    properties: {
      dayIso: { type: "string", description: "День у форматі 2026-09-07. За замовчуванням — сьогодні." },
    },
  },
  async run(ctx, args) {
    const target = validDay(args.dayIso, "dayIso", ctx.today);

    const reports = await prisma.warehouseReport.findMany({
      where: {
        userId: ctx.userId,
        createdAt: { gte: kyivDayStart(target), lte: kyivDayEnd(target) },
      },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        errorMessage: true,
        docType: true,
        docNumber: true,
        counterpartyName: true,
        totalAmount: true,
        itemsCount: true,
        createdAt: true,
      },
      take: 100,
    });

    const done = reports.filter((r) => r.status === "DONE");
    /** Те саме правило, що на екрані: у PENDING теж можна зупинитися назавжди. */
    const stuck = reports.filter((r) => r.status === "FAILED" || (r.status !== "DONE" && r.errorMessage));

    return {
      день: target,
      разом: {
        накладних: reports.length,
        прочитано: done.length,
        не_вийшло: stuck.length,
        на_суму: uah(done.reduce((s, r) => s + (r.totalAmount ?? 0), 0)),
        позицій: done.reduce((s, r) => s + r.itemsCount, 0),
      },
      накладні: reports.map((r) => ({
        час: hhmm(r.createdAt),
        номер: r.docNumber,
        вид: r.docType === "purchase" ? "прихідна" : r.docType === "sales" ? "видаткова" : null,
        контрагент: r.counterpartyName,
        позицій: r.itemsCount,
        сума: uah(r.totalAmount ?? 0),
        стан:
          r.status === "FAILED" || (r.status !== "DONE" && r.errorMessage)
            ? "не вийшло"
            : REPORT_STATE[r.status],
        помилка: r.errorMessage,
      })),
      підказка:
        stuck.length > 0
          ? "Непрочитані перезнімати не треба — фото на сервері, у розділі «Накладні» є кнопка «Спробувати ще раз»."
          : null,
    };
  },
};
