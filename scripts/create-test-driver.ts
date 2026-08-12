/** Разовий скрипт: тестовий акаунт водія + маршрут на сьогодні. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const p = new PrismaClient();

const EMAIL = "driver@budvik27.com";
const PASSWORD = "Driver2026";
const NAME = "Тестовий водій";

(async () => {
  // Email у нижньому регістрі: authorize() шукає саме так.
  const email = EMAIL.trim().toLowerCase();
  const password = await bcrypt.hash(PASSWORD, 10);

  const driver = await p.user.upsert({
    where: { email },
    create: { email, password, name: NAME, role: "DRIVER" },
    update: { password, role: "DRIVER", name: NAME },
  });
  console.log("Водій:", driver.id, driver.email, driver.role);

  // Київська доба
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  const asUtc = new Date(`${today}T00:00:00Z`);
  const off =
    new Date(asUtc.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })).getTime() -
    new Date(asUtc.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const dayStart = new Date(asUtc.getTime() - off);

  // Реальні клієнти з координатами — щоб точки лягли на карту як у житті.
  /**
   * Клієнти для тесту — власні, а не реальні.
   *
   * Спокуса взяти справжні картки велика (виглядало б життєвіше), але
   * щоб побачити кнопки інкасації, довелося б проставити їм борги — а
   * receivableBalance приходить з 1С і живе в аналітиці дебіторки.
   * Псувати бойові цифри заради демонстрації не можна.
   *
   * Координати — реальні місця у Львові, щоб об'їзд виглядав як робочий
   * день, а не як точки в чистому полі.
   */
  const FIXTURES = [
    { name: "ТЕСТ · Магазин на Шевченка", lat: 49.8449, lng: 24.0087, debt: 3200, amount: 8600 },
    { name: "ТЕСТ · Склад на Городоцькій", lat: 49.8352, lng: 23.9781, debt: 0, amount: 12400 },
    { name: "ТЕСТ · Точка на Липинського", lat: 49.8515, lng: 24.0246, debt: 1450, amount: 4200 },
    { name: "ТЕСТ · Магазин на Личаківській", lat: 49.8368, lng: 24.0533, debt: 7800, amount: 15300 },
    { name: "ТЕСТ · Кіоск на Стрийській", lat: 49.7940, lng: 24.0248, debt: 0, amount: 3150 },
  ];

  const real: Array<{
    id: string;
    name: string;
    deliveryLat: number | null;
    deliveryLng: number | null;
    receivableBalance: number | null;
  }> = [];
  for (const f of FIXTURES) {
    const c = await p.counterparty.upsert({
      where: { code: f.name },
      create: {
        code: f.name,
        name: f.name,
        address: f.name.replace("ТЕСТ · ", "Львів, "),
        deliveryLat: f.lat,
        deliveryLng: f.lng,
        // MANUAL — щоб точки не позначалися як «приблизні»
        geoSource: "MANUAL",
        receivableBalance: f.debt,
      },
      update: { deliveryLat: f.lat, deliveryLng: f.lng, receivableBalance: f.debt, isActive: true },
      select: { id: true, name: true, deliveryLat: true, deliveryLng: true, receivableBalance: true },
    });
    real.push(c);
  }
  console.log("Тестових клієнтів готово:", real.length);

  // Прибираємо попередній тестовий маршрут цього водія на сьогодні,
  // щоб повторний запуск не плодив дублі.
  const old = await p.deliveryRoute.findMany({
    where: { driverId: driver.id, date: { gte: dayStart, lte: new Date(dayStart.getTime() + 86_399_999) } },
    select: { id: true },
  });
  for (const r of old) {
    await p.deliveryStop.deleteMany({ where: { deliveryRouteId: r.id } });
    await p.deliveryRoute.delete({ where: { id: r.id } });
  }
  await p.salesDocument.deleteMany({ where: { number: { startsWith: "ТЕСТ-" } } });

  // Документ на кожну точку: планувальник вимагає salesDocumentId
  const stops = [];
  for (let i = 0; i < real.length; i++) {
    const c = real[i];
    const doc = await p.salesDocument.create({
      data: {
        number: `ТЕСТ-${1000 + i}`,
        docType: "REALIZATION",
        counterpartyId: c.id,
        totalAmount: [4200, 8600, 3150, 12400, 5700][i] ?? 5000,
        createdById: driver.id,
        // DRAFT і externalId=null: аналітика продажів фільтрує
        // `externalId IS NOT NULL AND status='CONFIRMED'`, тож тестові
        // документи не потраплять у жоден звіт.
        status: "DRAFT",
      },
    });
    stops.push({
      sequence: i + 1,
      counterpartyId: c.id,
      salesDocumentId: doc.id,
      address: null,
    });
  }

  const route = await p.deliveryRoute.create({
    data: {
      number: `ТЕСТ-МР-${today}`,
      driverId: driver.id,
      date: new Date(dayStart.getTime() + 8 * 3600_000),
      status: "PLANNED",
      vehicleInfo: "Renault Master (тест)",
      createdById: driver.id,
      stops: { create: stops },
    },
    include: { stops: { include: { counterparty: { select: { name: true } } } } },
  });

  // Борги реальним клієнтам НЕ чіпаємо: receivableBalance приходить з 1С
  // і живе в аналітиці дебіторки. Кнопки інкасації в чек-лісті з'являться
  // тоді, коли маршрут нестиме реальні борги (RouteSheetStop.debtAmount).

  console.log("\nМаршрут:", route.number, "—", route.stops.length, "точок:");
  route.stops.forEach((s, i) =>
    console.log(
      `  ${i + 1}. ${s.counterparty?.name} ` +
        `(${real[i].deliveryLat?.toFixed(4)}, ${real[i].deliveryLng?.toFixed(4)})`
    )
  );

  console.log("\n=== ДАНІ ДЛЯ ВХОДУ ===");
  console.log("Адреса: https://www.budvik27.com/login");
  console.log("Email:", email);
  console.log("Пароль:", PASSWORD);
  console.log("Далі: Мої маршрути → «Карта дня»  (або прямо /driver/tablet)");

  await p.$disconnect();
})().catch(async (e) => {
  console.error("ПАДІННЯ:", e);
  await p.$disconnect();
  process.exit(1);
});
