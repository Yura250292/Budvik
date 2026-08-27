/**
 * Наскрізна перевірка прийому точок: справжній HTTP, справжня база.
 *
 * Чисті функції геометрії вже перевіряють check-track-geo і
 * check-track-gaps. А от те, через що трек ламався насправді, живе не в
 * них: доба сесії, прив'язка до зміни, ідемпотентність повторної пачки.
 * Це видно лише на живому маршруті прийому.
 *
 * Працює на ТИМЧАСОВОМУ користувачеві, якого сам і прибирає: писати
 * підставні координати в день реального торгового не можна — з цих
 * кілометрів рахують зарплату.
 *
 * Потрібен піднятий сервер (npm run dev):
 *   npx tsx scripts/check-track-ingest.ts
 */
import { prisma } from "../src/lib/prisma";
import { issueDeviceToken } from "../src/lib/track/device-token";
import { kyivDate } from "../src/lib/date/kyiv";

const BASE = "http://localhost:3000";
let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  ✗ ${name}\n      маємо: ${JSON.stringify(got)}\n      треба: ${JSON.stringify(want)}`); }
  else console.log(`  ✓ ${name}`);
};
const ok = (name: string, cond: boolean, extra = "") => {
  if (!cond) { failed++; console.log(`  ✗ ${name} ${extra}`); } else console.log(`  ✓ ${name} ${extra}`);
};

async function send(token: string, points: unknown[], phase?: string) {
  const res = await fetch(`${BASE}/api/track/points`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ points, phase }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { email: `track-check-${stamp}@budvik.local`, name: "Перевірка треку", role: "SALES" },
    select: { id: true },
  });
  const token = await issueDeviceToken(user.id, "Перевірка");
  console.log(`Тимчасовий користувач ${user.id}\n`);

  try {
    // Зміна, ЯКУ ВЖЕ ЗАКРИТО: саме її хвіст досі губився.
    const today = kyivDate(new Date());
    const shiftStart = new Date(`${today}T05:00:00Z`); // 08:00 за Києвом
    const shiftEnd = new Date(`${today}T07:00:00Z`);   // 10:00 за Києвом
    const shift = await prisma.shift.create({
      data: { userId: user.id, status: "CLOSED", startedAt: shiftStart, endedAt: shiftEnd,
              startOdometer: 100, endOdometer: 120,
              startOdometerSource: "MANUAL", endOdometerSource: "MANUAL" },
      select: { id: true },
    });

    console.log("Пачка через київську північ");
    {
      const r = await send(token, [
        { lat: 49.8400, lng: 24.0300, accuracyM: 10, recordedAt: "2026-08-26T20:50:00Z" }, // 23:50 вчора
        { lat: 49.8420, lng: 24.0320, accuracyM: 10, recordedAt: "2026-08-26T20:55:00Z" },
        { lat: 49.8440, lng: 24.0340, accuracyM: 10, recordedAt: "2026-08-26T21:10:00Z" }, // 00:10 сьогодні
        { lat: 49.8460, lng: 24.0360, accuracyM: 10, recordedAt: "2026-08-26T21:15:00Z" },
      ]);
      check("Прийнято всі чотири", r.body?.accepted, 4);
      const sessions = await prisma.trackSession.findMany({
        where: { userId: user.id }, orderBy: { day: "asc" },
        select: { day: true, pointsCount: true },
      });
      check("Створено дві доби", sessions.length, 2);
      check("По дві точки в кожній", sessions.map(s => s.pointsCount), [2, 2]);
      // day зберігається як київська північ у UTC — це 21:00 попередньої доби.
      check("Доби 26 і 27 серпня за Києвом", sessions.map(s => s.day.toISOString().slice(0, 16)), ["2026-08-25T21:00", "2026-08-26T21:00"]);
    }

    console.log("\nБуфер, що доїхав після закриття зміни");
    {
      const r = await send(token, [
        { lat: 49.8500, lng: 24.0400, accuracyM: 10, recordedAt: `${today}T05:30:00Z` },
        { lat: 49.8560, lng: 24.0500, accuracyM: 10, recordedAt: `${today}T05:40:00Z` },
      ]);
      check("Прийнято обидві", r.body?.accepted, 2);
      const pts = await prisma.trackPoint.findMany({
        where: { userId: user.id, recordedAt: { gte: shiftStart, lte: shiftEnd } },
        select: { shiftId: true, phase: true },
      });
      ok("Обидві причеплені до закритої зміни", pts.length === 2 && pts.every(p => p.shiftId === shift.id));
      ok("Фаза SHIFT", pts.every(p => p.phase === "SHIFT"));
    }

    console.log("\nВідрізок, підбитий слабкими фіксами, добирається дорогою");
    {
      // Львів → Винники: надійна опора, шість фіксів по вежі, надійний кінець.
      const t = (min: number) => new Date(Date.parse(`${today}T09:00:00Z`) + min * 60_000).toISOString();
      const r = await send(token, [
        { lat: 49.8395, lng: 24.0297, accuracyM: 12, recordedAt: t(0) },
        { lat: 49.8360, lng: 24.0500, accuracyM: 600, recordedAt: t(3) },
        { lat: 49.8330, lng: 24.0700, accuracyM: 700, recordedAt: t(6) },
        { lat: 49.8300, lng: 24.0900, accuracyM: 650, recordedAt: t(9) },
        { lat: 49.8270, lng: 24.1100, accuracyM: 800, recordedAt: t(12) },
        { lat: 49.8240, lng: 24.1300, accuracyM: 550, recordedAt: t(15) },
        { lat: 49.8215, lng: 24.1450, accuracyM: 15, recordedAt: t(18) },
      ]);
      check("Прийнято всі сім", r.body?.accepted, 7);
      check("П’ять — «на віру»", r.body?.untrusted, 5);
      const last = await prisma.trackPoint.findFirst({
        where: { userId: user.id, recordedAt: new Date(t(18)) },
        select: { roadMetersFromPrev: true, gapGeometry: true, metersFromPrev: true },
      });
      if (last?.roadMetersFromPrev == null) {
        console.log("  ⚠ OSRM не відповів — дорога не добралась (перевірка пропущена)");
      } else {
        ok("Дорога довша за пряму", last.roadMetersFromPrev > 8000,
           `${(last.roadMetersFromPrev / 1000).toFixed(1)} км дорогою`);
        ok("Геометрія збережена", last.gapGeometry != null);
      }
    }

    console.log("\nПовторна відправка тієї самої пачки");
    {
      const before = await prisma.trackSession.findFirst({
        where: { userId: user.id, day: new Date(`${today}T00:00:00Z`) }, select: { distanceKm: true },
      });
      const r = await send(token, [
        { lat: 49.8500, lng: 24.0400, accuracyM: 10, recordedAt: `${today}T05:30:00Z` },
      ]);
      check("Нічого не прийнято", r.body?.accepted, 0);
      const after = await prisma.trackSession.findFirst({
        where: { userId: user.id, day: new Date(`${today}T00:00:00Z`) }, select: { distanceKm: true },
      });
      check("Пробіг не змінився", after?.distanceKm, before?.distanceKm);
    }
  } finally {
    await prisma.trackPoint.deleteMany({ where: { userId: user.id } });
    await prisma.trackSession.deleteMany({ where: { userId: user.id } });
    await prisma.deviceHeartbeat.deleteMany({ where: { userId: user.id } });
    await prisma.deviceToken.deleteMany({ where: { userId: user.id } });
    await prisma.shift.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log("\nТимчасові дані прибрано.");
  }

  console.log(failed ? `\n${failed} перевірок не зійшлося.` : "\nУсе зійшлося.");
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}
main();
