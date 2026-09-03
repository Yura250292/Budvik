/**
 * Наскрізна перевірка «дня маршрутів» і відправки посилання водієві.
 *
 * Запуск (потрібен піднятий npm run dev):
 *   npx tsx -r dotenv/config scripts/check-routes-day-api.ts dotenv_config_path=.env
 *
 * Створює водія, клієнтів, лист 1С і маршрути з маркером __e2e_routes__,
 * ганяє реальні HTTP-запити з підробленою сесією і прибирає за собою.
 *
 * Навіщо на живій базі: обидві половини задачі — про межі київської доби
 * (маршрут лежить як 00:00 UTC, лист 1С приходить зі своїм часом) і про
 * стани, яких на синтетиці не буває: водій без Telegram, чернетка, лист без
 * привʼязаного водія. Помилка тут тиха — логіст побачить порожній день.
 */

import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const p = new PrismaClient();
const BASE = process.env.ROUTE_CHECK_BASE ?? "http://localhost:3000";
const SECRET = process.env.NEXTAUTH_SECRET!;
const MARK = "__e2e_routes__";
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

/** Київська доба з зсувом у днях. */
function kyivDay(delta = 0): string {
  const d = new Date(Date.now() + delta * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
}

async function main() {
  const admin = await p.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, email: true, name: true } });
  if (!admin) {
    console.log("ADMIN у базі немає — перевірку неможливо провести.");
    process.exit(1);
  }

  const today = kyivDay(0);
  const tomorrow = kyivDay(1);

  const driver = await p.user.create({
    data: { email: `${MARK}driver@test.local`, name: `${MARK} Водій`, role: "DRIVER" },
  });

  // Клієнти в форматі 1С: один із ручним піном, другий узагалі без координати.
  const [pinned, noPin] = await Promise.all([
    p.counterparty.create({
      data: {
        name: `${MARK} Коваль (смт.Жовтанці)`,
        address: "смт.Жовтанці, вул.Івана Франка 2Г",
        deliveryLat: 49.9581, deliveryLng: 24.2372, geoSource: "MANUAL",
      },
    }),
    p.counterparty.create({
      data: { name: `${MARK} Кравець (м.Стрий)`, address: "м.Стрий, вул.Обаля 2" },
    }),
  ]);
  // Третій — щоб у маршруті було ДВІ координати (менше двох посилання не має сенсу).
  const pinned2 = await p.counterparty.create({
    data: {
      name: `${MARK} Налисник (м.Стрий)`,
      address: "м.Стрий, вул.Шевченка 5",
      deliveryLat: 49.2612, deliveryLng: 23.8562, geoSource: "MANUAL",
    },
  });

  const token = await encode({
    token: { sub: admin.id, id: admin.id, email: admin.email, name: admin.name, role: "ADMIN", boltsBalance: 0 },
    secret: SECRET,
  });
  const cookie = `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;
  const H = { "Content-Type": "application/json", Cookie: cookie };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const get = async (path: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  type Item = { kind: string; id: string; number: string; driverId: string | null; blocker?: string | null; progress?: { current: number | null; cta: string | null }; sheet?: { number: string; newStops: unknown[] } | null; existingRoute?: { number: string } | null };
  const day = async (d: string, driverId?: string) => {
    const r = await get(`/api/erp/delivery-routes/day?day=${d}${driverId ? `&driverId=${driverId}` : ""}`);
    return { status: r.status, items: (r.body?.items ?? []) as Item[], body: r.body };
  };

  // Маршрут на сьогодні: чернетка з трьома точками (дві з координатами).
  const created = await post("/api/erp/delivery-routes", {
    date: today,
    driverId: driver.id,
    notes: MARK,
    counterpartyIds: [pinned.id, noPin.id, pinned2.id],
  });
  const routeId: string = created.body?.id;
  check("Маршрут дня створено", created.status === 201 && !!routeId, created.status);

  // --- Відправка посилання ---
  const draftSend = await post(`/api/erp/delivery-routes/${routeId}/send-link`, {});
  check("Чернетка: надсилати рано → 409 NOT_ASSIGNED",
    draftSend.status === 409 && draftSend.body?.reason === "NOT_ASSIGNED", draftSend);

  const assigned = await post(`/api/erp/delivery-routes/${routeId}/assign`, { driverId: driver.id, date: today, force: true });
  check("Маршрут передано водію", assigned.status === 200, assigned.status);

  const noTg = await post(`/api/erp/delivery-routes/${routeId}/send-link`, {});
  check("Водій без Telegram → 200 NO_TELEGRAM (не помилка)",
    noTg.status === 200 && noTg.body?.sent === false && noTg.body?.reason === "NO_TELEGRAM", noTg);
  check("Разом із відмовою приходить готовий текст",
    typeof noTg.body?.text === "string" && noTg.body.text.includes("Google Maps"), noTg.body?.text?.slice(0, 60));
  check("Текст містить усі три точки, безпінна — з позначкою",
    noTg.body?.text?.includes("1. ") && noTg.body?.text?.includes("3. ") && noTg.body?.text?.includes("⚠"),
    noTg.body?.text);

  const stampSelect = { linkSentAt: true, linkSentVia: true, linkSentStops: true } as const;
  const noStamp = await p.deliveryRoute.findUnique({ where: { id: routeId }, select: stampSelect });
  check("Невдала відправка сліду не лишає", noStamp?.linkSentAt === null, noStamp);

  const shared = await post(`/api/erp/delivery-routes/${routeId}/send-link`, { channel: "SHARE" });
  check("Ручна відправка ставить штамп SHARE", shared.status === 200 && shared.body?.via === "SHARE", shared);
  const stamped = await p.deliveryRoute.findUnique({ where: { id: routeId }, select: stampSelect });
  check("Штамп у базі: коли, як і скільки точок",
    !!stamped?.linkSentAt && stamped?.linkSentVia === "SHARE" && stamped?.linkSentStops === 3, stamped);

  // Фальшивий telegramId: Telegram відповість помилкою, штамп мусить лишитися старим.
  const stampBefore = stamped?.linkSentAt;
  await p.user.update({ where: { id: driver.id }, data: { telegramId: `${MARK}-999` } });
  const broken = await post(`/api/erp/delivery-routes/${routeId}/send-link`, {});
  check("Збій Telegram → 502 з текстом для ручної відправки",
    broken.status === 502 && broken.body?.reason === "TELEGRAM_ERROR" && !!broken.body?.text, broken.status);
  const afterFail = await p.deliveryRoute.findUnique({ where: { id: routeId }, select: stampSelect });
  check("Збій не перетер попередній штамп", afterFail?.linkSentAt?.getTime() === stampBefore?.getTime(), afterFail);

  // Маршрут без координат узагалі.
  const flat = await post("/api/erp/delivery-routes", { date: today, driverId: driver.id, notes: MARK, counterpartyIds: [noPin.id] });
  await post(`/api/erp/delivery-routes/${flat.body.id}/assign`, { driverId: driver.id, date: today, force: true });
  const noCoords = await post(`/api/erp/delivery-routes/${flat.body.id}/send-link`, {});
  check("Без жодної координати → 422 NO_COORDS",
    noCoords.status === 422 && noCoords.body?.reason === "NO_COORDS", noCoords);

  // --- День: маршрути сайту й листи 1С разом ---
  const badDay = await get("/api/erp/delivery-routes/day?day=03.09.2026");
  check("Крива дата → 400", badDay.status === 400, badDay.status);

  const todayView = await day(today);
  check("GET /day → 200", todayView.status === 200, todayView.status);
  const mine = todayView.items.find((i) => i.id === routeId);
  check("Маршрут дня у списку", !!mine && mine.kind === "route", mine?.kind);
  check("Смуга кроків приїжджає з сервера",
    mine?.progress?.current === 4 || mine?.progress?.current === null, mine?.progress);
  check("Водії з ознакою Telegram",
    Array.isArray(todayView.body?.drivers) && todayView.body.drivers.some((d: { id: string; hasTelegram: boolean }) => d.id === driver.id && d.hasTelegram === true),
    todayView.body?.drivers?.length);

  // Лист 1С на завтра: у дні сьогодні його бути не повинно.
  const sheet = await p.routeSheet.create({
    data: {
      externalId: `${MARK}-sheet-1`,
      number: `${MARK}9001`,
      date: new Date(`${tomorrow}T09:00:00.000Z`),
      driverId: driver.id,
      driverName1C: "Тестовий В.",
      vehicle: "Kangoo",
      ordersTotal: 12000,
      debtsTotal: 500,
      stops: {
        create: [
          { sequence: 1, counterpartyId: pinned.id, address: "смт.Жовтанці, вул.Івана Франка 2Г", amount: 5000 },
          { sequence: 2, counterpartyId: pinned2.id, address: "м.Стрий, вул.Шевченка 5", amount: 7000 },
          { sequence: 3, counterpartyId: noPin.id, address: "прихована", amount: 0, hidden: true },
        ],
      },
    },
  });

  check("Лист на завтра не потрапляє в сьогодні",
    !(await day(today)).items.some((i) => i.kind === "sheet" && i.id === sheet.id), true);

  const tomorrowView = await day(tomorrow);
  const sheetItem = tomorrowView.items.find((i) => i.id === sheet.id);
  check("Лист 1С видно в його дні", !!sheetItem && sheetItem.kind === "sheet", sheetItem?.kind);
  check("Приховану точку в лист не рахуємо", (sheetItem as unknown as { stopsCount: number })?.stopsCount === 2, sheetItem);
  check("Лист із водієм і точками готовий до роботи", sheetItem?.blocker === null, sheetItem?.blocker);

  // Лист без привʼязаного водія — окремий стан, а не порожня картка.
  const orphan = await p.routeSheet.create({
    data: {
      externalId: `${MARK}-sheet-2`,
      number: `${MARK}9002`,
      date: new Date(`${tomorrow}T09:00:00.000Z`),
      driverName1C: "Невідомий В.",
      stops: { create: [{ sequence: 1, counterpartyId: pinned.id, address: "смт.Жовтанці", amount: 100 }] },
    },
  });
  const orphanItem = (await day(tomorrow)).items.find((i) => i.id === orphan.id);
  check("Лист без водія → blocker NO_DRIVER", orphanItem?.blocker === "NO_DRIVER", orphanItem?.blocker);
  check("Фільтр за водієм ховає непривʼязаний лист",
    !(await day(tomorrow, driver.id)).items.some((i) => i.id === orphan.id), true);

  // Конверсія: лист зникає зі списку й приїжджає всередині маршруту.
  const converted = await post("/api/admin/drivers/route-sheets/to-route", { sheetId: sheet.id });
  check("Лист сконвертовано в маршрут", converted.status === 200 && !!converted.body?.route?.id, converted.body);
  const afterConvert = await day(tomorrow);
  check("Лист більше не окремим рядком",
    !afterConvert.items.some((i) => i.kind === "sheet" && i.id === sheet.id), true);
  const fromSheet = afterConvert.items.find((i) => i.id === converted.body?.route?.id);
  check("Маршрут знає, з якого листа він зроблений",
    fromSheet?.sheet?.number === `${MARK}9001`, fromSheet?.sheet);
  check("Свіжий маршрут стоїть на кроці «Порядок»",
    fromSheet?.progress?.current === 2 && fromSheet?.progress?.cta === "ORDER", fromSheet?.progress);

  // Обмін привіз у лист нову точку — картка маршруту має це показати.
  const extraCp = await p.counterparty.create({
    data: { name: `${MARK} Новий (м.Львів)`, address: "м.Львів, вул.Нова 1", deliveryLat: 49.84, deliveryLng: 24.03 },
  });
  await p.routeSheetStop.create({
    data: { routeSheetId: sheet.id, sequence: 4, counterpartyId: extraCp.id, address: "м.Львів, вул.Нова 1", amount: 300 },
  });
  const drift = (await day(tomorrow)).items.find((i) => i.id === converted.body?.route?.id);
  check("Нова точка листа видно як зміну", drift?.sheet?.newStops?.length === 1, drift?.sheet);

  // --- Прибирання ---
  await p.routeSheetStop.deleteMany({ where: { routeSheet: { externalId: { startsWith: MARK } } } });
  await p.routeSheet.deleteMany({ where: { externalId: { startsWith: MARK } } });
  const convertedId: string | undefined = converted.body?.route?.id;
  const routeIds = [routeId, flat.body.id, ...(convertedId ? [convertedId] : [])];
  await p.deliveryStop.deleteMany({ where: { deliveryRouteId: { in: routeIds } } });
  await p.deliveryRoute.deleteMany({ where: { id: { in: routeIds } } });
  await p.counterparty.deleteMany({ where: { name: { contains: MARK } } });
  await p.notification.deleteMany({ where: { userId: driver.id } });
  await p.user.delete({ where: { id: driver.id } });

  const leftovers =
    (await p.user.count({ where: { email: { contains: MARK } } })) +
    (await p.counterparty.count({ where: { name: { contains: MARK } } })) +
    (await p.deliveryRoute.count({ where: { notes: MARK } })) +
    (await p.routeSheet.count({ where: { externalId: { startsWith: MARK } } }));
  check("Тестові дані прибрано повністю", leftovers === 0, leftovers);

  await p.$disconnect();
  console.log(failed === 0 ? `\nУсе зійшлося (день ${today}, завтра ${tomorrow}).` : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

/**
 * Аварійне прибирання. Потрібне не для краси: 03.09 прогін урвався на
 * розриві зʼєднання з базою, і маршрут із маркером лишився в проді — його
 * побачив би логіст у списку дня.
 */
main().catch(async (e) => {
  console.error("ПАДІННЯ:", e);
  const routes = await p.deliveryRoute
    .findMany({ where: { notes: MARK }, select: { id: true } })
    .catch(() => []);
  await p.deliveryStop.deleteMany({ where: { deliveryRouteId: { in: routes.map((r) => r.id) } } }).catch(() => {});
  await p.deliveryRoute.deleteMany({ where: { notes: MARK } }).catch(() => {});
  await p.routeSheetStop.deleteMany({ where: { routeSheet: { externalId: { startsWith: MARK } } } }).catch(() => {});
  await p.routeSheet.deleteMany({ where: { externalId: { startsWith: MARK } } }).catch(() => {});
  await p.counterparty.deleteMany({ where: { name: { contains: MARK } } }).catch(() => {});
  await p.user.deleteMany({ where: { email: { contains: MARK } } }).catch(() => {});
  await p.$disconnect();
  process.exit(1);
});
