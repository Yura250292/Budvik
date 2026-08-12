/**
 * Наскрізна перевірка планшетного API на тимчасових даних.
 *
 * Запуск (потрібен піднятий npm run dev):
 *   npx tsx scripts/check-tablet-api.ts
 *
 * Створює водія, клієнтів і маршрутний лист із маркером __e2e_tablet__,
 * ганяє реальні HTTP-запити з підробленою сесією і прибирає за собою.
 * Остання перевірка підтверджує, що в базі не лишилося сміття.
 *
 * Потрібен, бо тестового раннера в проєкті немає, а ця логіка їде в
 * машину: помилка в арифметиці пробігу — це помилка в зарплаті водія.
 */
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const p = new PrismaClient();
const BASE = "http://localhost:3000";
const SECRET = process.env.NEXTAUTH_SECRET!;

const MARK = "__e2e_tablet__";
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

async function main() {
  // --- Підготовка ---
  const driver = await p.user.create({
    data: { email: `${MARK}driver@test.local`, name: `${MARK} Водій`, role: "DRIVER" },
  });

  const clients = await Promise.all(
    [
      { name: `${MARK} Магазин А`, lat: 49.8419, lng: 24.0315, debt: 3200 },
      { name: `${MARK} Магазин Б`, lat: 49.8600, lng: 24.1000, debt: 0 },
      { name: `${MARK} Магазин В`, lat: 49.9000, lng: 24.2000, debt: 1500 },
    ].map((c) =>
      p.counterparty.create({
        data: {
          name: c.name,
          address: `вул. Тестова, ${c.name}`,
          deliveryLat: c.lat,
          deliveryLng: c.lng,
          geoSource: "GEOCODED",
          receivableBalance: c.debt,
        },
      })
    )
  );

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  const dayStart = new Date(`${today}T00:00:00Z`);
  const kyivOffset =
    new Date(dayStart.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })).getTime() -
    new Date(dayStart.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const dayStartUtc = new Date(dayStart.getTime() - kyivOffset);

  const sheet = await p.routeSheet.create({
    data: {
      externalId: `${MARK}sheet-1`,
      number: `${MARK}МЛ-001`,
      date: new Date(dayStartUtc.getTime() + 8 * 3600_000),
      driverId: driver.id,
      driverName1C: "Тестовий В.",
      vehicle: "Renault Master",
      distanceKm: 120,
      ordersTotal: 45000,
      debtsTotal: 4700,
      stops: {
        create: [
          { sequence: 1, counterpartyId: clients[0].id, address: "вул. Тестова, А", amount: 20000, debtAmount: 3200 },
          { sequence: 2, counterpartyId: clients[1].id, address: "вул. Тестова, Б", amount: 15000, debtAmount: 0 },
          // Дубль тієї самої адреси — має злитися в одну точку
          { sequence: 3, counterpartyId: clients[2].id, address: "вул. Тестова, В", amount: 5000, debtAmount: 1500 },
          { sequence: 4, counterpartyId: clients[2].id, address: "вул. Тестова, В", amount: 5000, debtAmount: 0 },
        ],
      },
    },
  });

  const token = await encode({
    token: { sub: driver.id, id: driver.id, email: driver.email, name: driver.name, role: "DRIVER", boltsBalance: 0 },
    secret: SECRET,
  });
  const cookie = `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;
  const H = { "Content-Type": "application/json", Cookie: cookie };

  const get = async (path: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // --- 1. День планшета ---
  const day1 = await get("/api/tablet/day");
  check("GET /api/tablet/day → 200", day1.status === 200, day1);
  check("Джерело — маршрутний лист 1С", day1.body?.route?.source === "ROUTE_SHEET", day1.body?.route?.source);
  check("Номер листа віддано", day1.body?.route?.number === `${MARK}МЛ-001`, day1.body?.route?.number);
  check("4 рядки злилися у 3 точки", day1.body?.route?.stops?.length === 3, day1.body?.route?.stops?.length);

  const stopV = day1.body?.route?.stops?.find((s: { name: string }) =>
    s.name.includes("Магазин В")
  );
  check("Суми дублів склалися (5000+5000)", stopV?.amount === 10000, stopV?.amount);
  check("Координати підтягнулися з картки клієнта", stopV?.lat === 49.9, stopV?.lat);
  check("Борг по точці А = 3200", day1.body?.route?.stops?.[0]?.debtAmount === 3200, day1.body?.route?.stops?.[0]);
  check("Прогрес: 3 точки, 0 відмічено", day1.body?.progress?.total === 3 && day1.body?.progress?.done === 0, day1.body?.progress);
  check("Планований борг = 4700", day1.body?.progress?.debtPlanned === 4700, day1.body?.progress?.debtPlanned);
  check("Трек порожній", day1.body?.track?.pointsCount === 0, day1.body?.track);

  // --- 1b. Маршрут сайту має пріоритет над листом 1С ---
  // 1С не знає, яку накладну повіз який водій (проби fe9debc, 2c8591e), і
  // маршрут складає логіст на сайті. Тому порожній або чужий лист із 1С не
  // сміє перекривати реальний маршрут дня.
  const plannedRoute = await p.deliveryRoute.create({
    data: {
      number: `${MARK}МР-1`,
      driverId: driver.id,
      date: new Date(dayStartUtc.getTime() + 9 * 3600_000),
      status: "PLANNED",
      createdById: driver.id,
      vehicleInfo: "Fiat Ducato",
      stops: {
        create: [
          {
            sequence: 1,
            counterpartyId: clients[0].id,
            address: "вул. Тестова, А",
            salesDocumentId: (
              await p.salesDocument.create({
                data: {
                  number: `${MARK}РН-1`,
                  docType: "REALIZATION",
                  counterpartyId: clients[0].id,
                  totalAmount: 7000,
                  createdById: driver.id,
                },
              })
            ).id,
          },
        ],
      },
    },
  });

  const day1b = await get("/api/tablet/day");
  check("Маршрут сайту переміг лист 1С", day1b.body?.route?.source === "DELIVERY_ROUTE", day1b.body?.route?.source);
  check("Номер маршруту сайту", day1b.body?.route?.number === `${MARK}МР-1`, day1b.body?.route?.number);
  check("Сума з документа реалізації", day1b.body?.route?.stops?.[0]?.amount === 7000, day1b.body?.route?.stops?.[0]?.amount);

  // Прибираємо, щоб решта перевірок ішла на маршрутному листі
  await p.deliveryStop.deleteMany({ where: { deliveryRouteId: plannedRoute.id } });
  await p.deliveryRoute.delete({ where: { id: plannedRoute.id } });
  await p.salesDocument.deleteMany({ where: { number: { startsWith: MARK } } });

  // --- 2. Трек ---
  // База часу фіксується ОДИН раз: інакше повторна пачка отримала б нові
  // мітки й перестала бути повторною — саме на цьому спіткнувся перший
  // прогін тесту.
  const base = Date.now();
  const t = (min: number) => new Date(base - (60 - min) * 60_000).toISOString();
  const batch1 = await post("/api/track/points", {
    points: [
      { lat: 49.8419, lng: 24.0315, accuracyM: 10, recordedAt: t(0) },
      { lat: 49.8600, lng: 24.1000, accuracyM: 12, recordedAt: t(10) },
      { lat: 49.8500, lng: 24.0500, accuracyM: 500, recordedAt: t(15) }, // відсів
    ],
  });
  check("POST /api/track/points → 200", batch1.status === 200, batch1);
  check("Прийнято 2 з 3", batch1.body?.accepted === 2, batch1.body);
  check("Точку з похибкою 500 м відкинуто", batch1.body?.rejected?.accuracy === 1, batch1.body?.rejected);
  check("Пробіг > 0", batch1.body?.sessionDistanceKm > 0, batch1.body?.sessionDistanceKm);

  const kmAfter1 = batch1.body?.sessionDistanceKm;

  // Повторна та сама пачка — ідемпотентність
  const batch1again = await post("/api/track/points", {
    points: [
      { lat: 49.8419, lng: 24.0315, accuracyM: 10, recordedAt: t(0) },
      { lat: 49.8600, lng: 24.1000, accuracyM: 12, recordedAt: t(10) },
    ],
  });
  check("Повторна пачка: 0 прийнято", batch1again.body?.accepted === 0, batch1again.body);
  check("Пробіг не подвоївся і не змінив формат", batch1again.body?.sessionDistanceKm === kmAfter1, {
    was: kmAfter1, now: batch1again.body?.sessionDistanceKm,
  });

  // Та сама координата з новішою міткою — теж дубль (перештампований ретрай)
  const restamped = await post("/api/track/points", {
    points: [{ lat: 49.8600, lng: 24.1000, accuracyM: 12, recordedAt: t(12) }],
  });
  check("Дубль координати з новим часом відкинуто", restamped.body?.accepted === 0, restamped.body);

  // Продовження дня: остання точка — «зараз», щоб водій вважався онлайн
  const batch2 = await post("/api/track/points", {
    points: [{ lat: 49.9000, lng: 24.2000, accuracyM: 8, recordedAt: new Date().toISOString() }],
  });
  check("Друга пачка прийнята", batch2.body?.accepted === 1, batch2.body);
  check("Пробіг виріс від попереднього", batch2.body?.sessionDistanceKm > kmAfter1, batch2.body?.sessionDistanceKm);

  // Порожня і завелика пачки
  const empty = await post("/api/track/points", { points: [] });
  check("Порожня пачка → 400", empty.status === 400, empty);
  const huge = await post("/api/track/points", { points: Array(501).fill({ lat: 49.8, lng: 24.0, recordedAt: t(30) }) });
  check("501 точка → 400", huge.status === 400, huge);

  // --- 3. Візити ---
  const v1 = await post("/api/visits", {
    counterpartyId: clients[0].id,
    status: "DONE",
    money: "FULL",
    debtAmount: 3200,
    lat: 49.8419,
    lng: 24.0315,
    accuracyM: 8,
  });
  check("Візит DONE+FULL → 200", v1.status === 200, v1);
  check("FULL підставив борг 3200", v1.body?.visit?.collectedAmount === 3200, v1.body?.visit);

  const v2 = await post("/api/visits", {
    counterpartyId: clients[1].id,
    status: "MISSED",
    comment: "Магазин був закритий",
    money: "NOT_APPLICABLE",
  });
  check("Візит MISSED з коментарем → 200", v2.status === 200, v2);
  check("Коментар збережено", v2.body?.visit?.comment === "Магазин був закритий", v2.body?.visit?.comment);

  const v3bad = await post("/api/visits", { counterpartyId: clients[2].id, status: "DONE", money: "PARTIAL" });
  check("PARTIAL без суми → 400", v3bad.status === 400, v3bad);

  const v3 = await post("/api/visits", {
    counterpartyId: clients[2].id, status: "DONE", money: "PARTIAL", collectedAmount: 700,
  });
  check("PARTIAL із сумою → 200", v3.status === 200, v3);
  check("Часткова сума 700", v3.body?.visit?.collectedAmount === 700, v3.body?.visit?.collectedAmount);

  const vNeg = await post("/api/visits", {
    counterpartyId: clients[2].id, status: "DONE", money: "PARTIAL", collectedAmount: -50,
  });
  check("Від'ємна сума → 400", vNeg.status === 400, vNeg);

  // Повторний тап — редагує, не дублює
  const v1again = await post("/api/visits", {
    counterpartyId: clients[0].id, status: "DONE", money: "NONE",
  });
  check("Повторний візит → 200", v1again.status === 200, v1again);
  check("Той самий id (upsert, не дубль)", v1again.body?.visit?.id === v1.body?.visit?.id, {
    was: v1.body?.visit?.id, now: v1again.body?.visit?.id,
  });
  check("NONE обнулив суму", v1again.body?.visit?.collectedAmount === 0, v1again.body?.visit?.collectedAmount);

  const visitCount = await p.visit.count({ where: { userId: driver.id } });
  check("У базі рівно 3 візити", visitCount === 3, visitCount);

  const vNoClient = await post("/api/visits", { counterpartyId: "неіснуючий", status: "DONE" });
  check("Неіснуючий клієнт → 404", vNoClient.status === 404, vNoClient);

  // --- 4. День після відміток ---
  const day2 = await get("/api/tablet/day");
  check("Візити повернулись у дні", day2.body?.route?.stops?.[0]?.visit?.status === "DONE", day2.body?.route?.stops?.[0]?.visit);
  check("Прогрес: 2 done, 1 missed", day2.body?.progress?.done === 2 && day2.body?.progress?.missed === 1, day2.body?.progress);
  check("Зібрано 700 (0 + 0 + 700)", day2.body?.progress?.collected === 700, day2.body?.progress?.collected);
  check("Трек у дні: 3 точки", day2.body?.track?.pointsCount === 3, day2.body?.track);
  check("Path для polyline є", Array.isArray(day2.body?.track?.path) && day2.body.track.path.length === 3, day2.body?.track?.path?.length);

  // --- 5. Водій не має доступу до адмінських ---
  const adminLive = await get("/api/admin/track/live");
  check("DRIVER на /api/admin/track/live → 403", adminLive.status === 403, adminLive.status);
  const adminDay = await get(`/api/admin/track/${driver.id}/day`);
  check("DRIVER на /api/admin/track/[id]/day → 403", adminDay.status === 403, adminDay.status);

  // --- 6. Адмін бачить ---
  const admin = await p.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, email: true, name: true } });
  if (admin) {
    const adminToken = await encode({
      token: { sub: admin.id, id: admin.id, email: admin.email, name: admin.name, role: "ADMIN", boltsBalance: 0 },
      secret: SECRET,
    });
    const aCookie = `next-auth.session-token=${adminToken}; __Secure-next-auth.session-token=${adminToken}`;
    const aGet = async (path: string) => {
      const r = await fetch(`${BASE}${path}`, { headers: { Cookie: aCookie } });
      return { status: r.status, body: await r.json().catch(() => null) };
    };

    const live = await aGet("/api/admin/track/live");
    check("ADMIN /live → 200", live.status === 200, live.status);
    const me = live.body?.people?.find((x: { userId: string }) => x.userId === driver.id);
    check("Водій у списку живих", !!me, live.body?.people?.length);
    check("Онлайн (точка свіжа)", me?.online === true, me);
    check("Остання координата — з останньої точки", me?.lat === 49.9, me?.lat);

    const aDay = await aGet(`/api/admin/track/${driver.id}/day`);
    check("ADMIN /track/[id]/day → 200", aDay.status === 200, aDay.status);
    check("Звірка з 1С: пробіг листа 120", aDay.body?.sheet1C?.distanceKm === 120, aDay.body?.sheet1C);
    check("Звірка: зібрано 700", aDay.body?.sheet1C?.collected === 700, aDay.body?.sheet1C?.collected);
    check("Трек із 3 точок", aDay.body?.track?.points?.length === 3, aDay.body?.track?.points?.length);
    check("Візити з іменами клієнтів", aDay.body?.visits?.[0]?.counterparty?.name?.includes("Магазин"), aDay.body?.visits?.[0]?.counterparty?.name);
  } else {
    console.log("… ADMIN не знайдено, адмінські перевірки пропущено");
  }

  // --- Прибирання ---
  await p.trackPoint.deleteMany({ where: { userId: driver.id } });
  await p.trackSession.deleteMany({ where: { userId: driver.id } });
  await p.visit.deleteMany({ where: { userId: driver.id } });
  await p.routeSheetStop.deleteMany({ where: { routeSheetId: sheet.id } });
  await p.routeSheet.delete({ where: { id: sheet.id } });
  await p.counterparty.deleteMany({ where: { name: { startsWith: MARK } } });
  await p.user.delete({ where: { id: driver.id } });

  const leftovers =
    (await p.user.count({ where: { email: { contains: MARK } } })) +
    (await p.counterparty.count({ where: { name: { startsWith: MARK } } })) +
    (await p.routeSheet.count({ where: { externalId: { startsWith: MARK } } }));
  check("Тестові дані прибрано повністю", leftovers === 0, leftovers);

  await p.$disconnect();
  console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ПАДІННЯ:", e);
  await p.$disconnect();
  process.exit(1);
});
