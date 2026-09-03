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

  let row = await p.deliveryRoute.findUnique({ where: { id: routeId }, select: { linkSentAt: true } });
  check("Невдала відправка сліду не лишає", row?.linkSentAt === null, row);

  const shared = await post(`/api/erp/delivery-routes/${routeId}/send-link`, { channel: "SHARE" });
  check("Ручна відправка ставить штамп SHARE", shared.status === 200 && shared.body?.via === "SHARE", shared);
  row = await p.deliveryRoute.findUnique({ where: { id: routeId }, select: { linkSentAt: true, linkSentVia: true, linkSentStops: true } });
  check("Штамп у базі: коли, як і скільки точок",
    !!row?.linkSentAt && row?.linkSentVia === "SHARE" && row?.linkSentStops === 3, row);

  // Фальшивий telegramId: Telegram відповість помилкою, штамп мусить лишитися старим.
  const stampBefore = row?.linkSentAt;
  await p.user.update({ where: { id: driver.id }, data: { telegramId: `${MARK}-999` } });
  const broken = await post(`/api/erp/delivery-routes/${routeId}/send-link`, {});
  check("Збій Telegram → 502 з текстом для ручної відправки",
    broken.status === 502 && broken.body?.reason === "TELEGRAM_ERROR" && !!broken.body?.text, broken.status);
  row = await p.deliveryRoute.findUnique({ where: { id: routeId }, select: { linkSentAt: true } });
  check("Збій не перетер попередній штамп", row?.linkSentAt?.getTime() === stampBefore?.getTime(), row);

  // Маршрут без координат узагалі.
  const flat = await post("/api/erp/delivery-routes", { date: today, driverId: driver.id, notes: MARK, counterpartyIds: [noPin.id] });
  await post(`/api/erp/delivery-routes/${flat.body.id}/assign`, { driverId: driver.id, date: today, force: true });
  const noCoords = await post(`/api/erp/delivery-routes/${flat.body.id}/send-link`, {});
  check("Без двох координат → 422 NO_COORDS",
    noCoords.status === 422 && noCoords.body?.reason === "NO_COORDS", noCoords);

  // --- Прибирання ---
  await p.deliveryStop.deleteMany({ where: { deliveryRouteId: { in: [routeId, flat.body.id] } } });
  await p.deliveryRoute.deleteMany({ where: { id: { in: [routeId, flat.body.id] } } });
  await p.counterparty.deleteMany({ where: { name: { contains: MARK } } });
  await p.notification.deleteMany({ where: { userId: driver.id } });
  await p.user.delete({ where: { id: driver.id } });

  const leftovers =
    (await p.user.count({ where: { email: { contains: MARK } } })) +
    (await p.counterparty.count({ where: { name: { contains: MARK } } })) +
    (await p.deliveryRoute.count({ where: { notes: MARK } }));
  check("Тестові дані прибрано повністю", leftovers === 0, leftovers);

  await p.$disconnect();
  console.log(failed === 0 ? `\nУсе зійшлося (день ${today}, завтра ${tomorrow}).` : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ПАДІННЯ:", e);
  await p.counterparty.deleteMany({ where: { name: { contains: MARK } } }).catch(() => {});
  await p.user.deleteMany({ where: { email: { contains: MARK } } }).catch(() => {});
  await p.$disconnect();
  process.exit(1);
});
