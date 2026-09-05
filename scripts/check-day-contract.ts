/**
 * Звірка форми /api/tablet/day з тим, чого чекає нативний екран дня.
 *
 * Запуск (потрібен піднятий npm run dev):
 *   npx tsx scripts/check-day-contract.ts
 *
 * Заради чого. Типи `DayResponse` і `DayStop` у mobile/src/api/staff.ts —
 * скопійовані руками: застосунок не має доступу до коду сайту. Розбіжність не
 * впаде і не засвітиться в логах — вона проявиться порожніми полями на екрані
 * водія, який стоїть біля магазину. Тому форму звіряємо машинно.
 *
 * Перевіряємо саме те, на що екран спирається: назви полів і їхні типи. Значень
 * не перевіряємо — вони залежать від дня.
 */
import { PrismaClient } from "@prisma/client";
import { issueDeviceToken } from "../src/lib/track/device-token";

const p = new PrismaClient();
const BASE = process.env.DAY_CHECK_BASE ?? "http://localhost:3000";
const MARK = "__e2e_day__";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

/** Поля, які читає mobile/src/app/day.tsx. Тип → перевірка значення. */
const DAY_FIELDS: Record<string, (v: unknown) => boolean> = {
  day: (v) => typeof v === "string",
  role: (v) => typeof v === "string",
  progress: (v) => typeof v === "object" && v !== null,
  track: (v) => typeof v === "object" && v !== null,
  cash: (v) => typeof v === "object" && v !== null,
};
const PROGRESS_FIELDS = ["total", "done", "missed", "left", "collected", "debtPlanned"];
const TRACK_FIELDS = ["distanceKm", "pointsCount", "lastPointAt"];
const CASH_FIELDS = ["collected", "handed", "onHands", "handovers"];
/**
 * Поля маршруту, які читає застосунок.
 *
 * `mine` і `driverName` тут не заради повноти: відколи водій бачить листи
 * колег, саме вони вирішують, показувати кнопки відміток і касу чи ні.
 * Зникни вони з відповіді — застосунок мовчки вважав би чужий лист своїм.
 */
const ROUTE_FIELDS = [
  "source", "id", "day", "number", "vehicle", "plannedKm", "geometry",
  "driverId", "driverName", "mine", "myOrder", "stops",
];

const STOP_FIELDS = [
  "key", "counterpartyId", "name", "address", "lat", "lng", "geoSource",
  "sequence", "sheetSeq", "amount", "debtAmount", "kind", "notes", "visit",
  "routeSheetStopId", "deliveryStopId",
];

/**
 * Поля, які сервер шле, а застосунок свідомо не читає.
 *
 * Список потрібен, щоб «не читаємо» було рішенням, а не недоглядом: усе, чого
 * немає ні тут, ні в STOP_FIELDS, звірка завалює. Саме так знайшовся geoSource
 * — він їхав із сервера з першого дня, а водій не бачив підпису «точка
 * приблизна» й довіряв піну, який означав лише «десь у цьому місті».
 */
const SERVER_ONLY_STOP_FIELDS: Record<string, string> = {
  mergedKeys:
    "кілька рядків листа з тією самою адресою злиті в одну точку; відмітка йде за клієнтом, і сервер робить upsert по (користувач, день, клієнт) — окремі ключі клієнту не потрібні",
  ownVisit:
    "внутрішнє поле збирача: у visit уже підставлений результат (ownVisit ?? візит клієнта)",
};

async function cleanup() {
  const users = await p.user.findMany({ where: { email: { startsWith: MARK } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const sheets = await p.routeSheet.findMany({ where: { externalId: { startsWith: MARK } }, select: { id: true } });
  await p.routeSheetStop.deleteMany({ where: { routeSheetId: { in: sheets.map((s) => s.id) } } });
  await p.routeSheet.deleteMany({ where: { id: { in: sheets.map((s) => s.id) } } });
  // Візити прибираємо ПЕРШИМИ: якби запобіжник на чужий лист не спрацював,
  // відмітка створилася б, і видалення клієнта впало б на зовнішньому ключі —
  // тобто перевірка лишила б по собі сміття саме тоді, коли провалилась.
  const clients = await p.counterparty.findMany({
    where: { name: { startsWith: MARK } },
    select: { id: true },
  });
  await p.visit.deleteMany({ where: { counterpartyId: { in: clients.map((c) => c.id) } } });
  await p.counterparty.deleteMany({ where: { name: { startsWith: MARK } } });
  await p.deviceToken.deleteMany({ where: { userId: { in: ids } } });
  await p.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  await cleanup();

  const driver = await p.user.create({
    data: { email: `${MARK}driver@test.local`, name: `${MARK} Водій`, role: "DRIVER" },
  });
  const client = await p.counterparty.create({
    data: {
      name: `${MARK} Магазин`,
      address: "вул. Тестова, 1",
      deliveryLat: 49.8419,
      deliveryLng: 24.0315,
      geoSource: "GEOCODED",
      receivableBalance: 1200,
    },
  });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  const mySheet = await p.routeSheet.create({
    data: {
      externalId: `${MARK}sheet`,
      number: `${MARK}МЛ-9`,
      // Полудень київського дня — щоб точно потрапити в «сьогодні».
      date: new Date(`${today}T09:00:00Z`),
      driverId: driver.id,
      driverName1C: "Тест",
      stops: {
        create: [
          { sequence: 1, counterpartyId: client.id, address: "вул. Тестова, 1", amount: 5000, debtAmount: 1200 },
        ],
      },
    },
  });

  /** Другий водій із власним листом — щоб перевірити «чуже». */
  const mate = await p.user.create({
    data: { email: `${MARK}mate@test.local`, name: `${MARK} Колега`, role: "DRIVER" },
  });
  const foreignSheet = await p.routeSheet.create({
    data: {
      externalId: `${MARK}sheet-mate`,
      number: `${MARK}МЛ-10`,
      date: new Date(`${today}T09:00:00Z`),
      driverId: mate.id,
      driverName1C: "Колега",
      stops: {
        create: [
          { sequence: 1, counterpartyId: client.id, address: "вул. Тестова, 2", amount: 700, debtAmount: 0 },
        ],
      },
    },
  });

  const token = await issueDeviceToken(driver.id, "e2e-day");
  const res = await fetch(`${BASE}/api/tablet/day`, {
    headers: { Authorization: `Bearer ${token}`, "x-budvik-app": "staff/10100" },
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  check("GET /api/tablet/day через Bearer → 200", res.status === 200, res.status);
  if (!body) {
    await cleanup();
    await p.$disconnect();
    console.log("\nПровалено: тіло не прочиталося");
    process.exit(1);
  }

  for (const [field, ok] of Object.entries(DAY_FIELDS)) {
    check(`Поле "${field}" є і того типу`, field in body && ok(body[field]), body[field]);
  }

  const progress = body.progress as Record<string, unknown>;
  for (const f of PROGRESS_FIELDS) {
    check(`progress.${f} — число`, typeof progress?.[f] === "number", progress?.[f]);
  }

  const track = body.track as Record<string, unknown>;
  for (const f of TRACK_FIELDS) check(`track.${f} присутнє`, f in (track ?? {}), track?.[f]);

  const cash = body.cash as Record<string, unknown>;
  for (const f of CASH_FIELDS) check(`cash.${f} присутнє`, f in (cash ?? {}), cash?.[f]);
  check("cash.handovers — масив", Array.isArray(cash?.handovers), cash?.handovers);

  const route = body.route as Record<string, unknown> | null;
  for (const f of ROUTE_FIELDS) {
    check(`route.${f} присутнє`, !!route && f in route, route?.[f]);
  }
  check("route.mine — булеве", typeof route?.mine === "boolean", route?.mine);
  check("Свій лист позначено як свій", route?.mine === true, route?.mine);
  check("route.stops — масив", Array.isArray(route?.stops), route?.stops);
  const stop = (route?.stops as Record<string, unknown>[])?.[0];
  check("У дні є наша точка", !!stop, stop);
  if (stop) {
    for (const f of STOP_FIELDS) {
      check(`stop.${f} присутнє`, f in stop, { [f]: stop[f] });
    }
    /**
     * Ключ точки — те, з чого екран дістає id для відмітки (`key.slice(3)`).
     * Без префікса відмітка пішла б із порожнім id і мовчки не прив'язалася.
     */
    check(
      "stop.key має префікс rs:/ds:",
      typeof stop.key === "string" && (stop.key.startsWith("rs:") || stop.key.startsWith("ds:")),
      stop.key
    );
    check(
      "stop.kind — одне з DELIVERY/PICKUP/ERRAND",
      ["DELIVERY", "PICKUP", "ERRAND"].includes(String(stop.kind)),
      stop.kind
    );

    /**
     * Зворотний бік звірки, без якого вона пропустила справжню розбіжність.
     *
     * Досі перевірялося лише «чи є на сервері те, що читає екран». Поле, яке
     * сервер ШЛЕ, а застосунок про нього не знає, проходило мовчки — саме так
     * `geoSource` віддавався з першого дня, а водій не бачив підпису «точка
     * приблизна» і їхав за піном, який означав лише «десь у цьому місті».
     *
     * Нове поле в точці дня — це не помилка, але воно мусить бути ЗГАДАНЕ тут
     * свідомо: або застосунок його показує, або хтось написав, чому ні.
     */
    const KNOWN = new Set(STOP_FIELDS);
    for (const f of Object.keys(stop)) {
      const skipReason = SERVER_ONLY_STOP_FIELDS[f];
      if (skipReason) {
        console.log(`· stop.${f} — свідомо не читаємо: ${skipReason}`);
        continue;
      }
      check(`stop.${f} відоме застосунку`, KNOWN.has(f), {
        поле: f,
        значення: stop[f],
        що_робити:
          "додати в DayStop у mobile/src/api/staff.ts і сюди — або в SERVER_ONLY_STOP_FIELDS із поясненням",
      });
    }
  }

  /**
   * Лист колеги: відкрити можна, відмітити — ні.
   *
   * Найдорожча помилка цієї доробки виглядала б так: чужий лист приїжджає
   * без ознаки «чужий», застосунок показує кнопки відміток, і два водії
   * пишуть візити одному клієнту. Тому перевіряємо обидва боки — і що лист
   * ВІДКРИВАЄТЬСЯ (інакше вся доробка марна), і що сервер не приймає в
   * нього відмітку.
   */
  const foreignRes = await fetch(
    `${BASE}/api/tablet/day?route=rs:${foreignSheet.id}`,
    { headers: { Authorization: `Bearer ${token}`, "x-budvik-app": "staff/10100" } }
  );
  const foreignBody = (await foreignRes.json().catch(() => null)) as Record<string, unknown> | null;
  const foreignRoute = foreignBody?.route as Record<string, unknown> | undefined;

  check("Чужий лист відкривається", foreignRes.status === 200, foreignRes.status);
  check("Чужий лист позначено чужим", foreignRoute?.mine === false, foreignRoute?.mine);
  check(
    "Видно, чий це лист",
    typeof foreignRoute?.driverName === "string" && String(foreignRoute.driverName).includes(MARK),
    foreignRoute?.driverName
  );
  check("Точки чужого листа приїхали", (foreignRoute?.stops as unknown[])?.length === 1, foreignRoute?.stops);
  check(
    "Каса чужого дня не показується як своя",
    (foreignBody?.cash as { collected?: number })?.collected === 0,
    foreignBody?.cash
  );
  check("Візити поза планом на чужому листі порожні", (foreignBody?.extraVisits as unknown[])?.length === 0);

  const foreignStopId = (
    await p.routeSheetStop.findFirst({ where: { routeSheetId: foreignSheet.id }, select: { id: true } })
  )?.id;
  const markRes = await fetch(`${BASE}/api/visits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-budvik-app": "staff/10100",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      counterpartyId: client.id,
      status: "DONE",
      money: "NONE",
      routeSheetStopId: foreignStopId,
    }),
  });
  check("Відмітка в чужому листі відхилена (403)", markRes.status === 403, markRes.status);

  /** Список листів: обидва видно, свій вище чужого того самого дня. */
  const listRes = await fetch(`${BASE}/api/driver/routes`, {
    headers: { Authorization: `Bearer ${token}`, "x-budvik-app": "staff/10100" },
  });
  const list = (await listRes.json().catch(() => null)) as
    | { items?: Array<Record<string, unknown>> }
    | null;
  const mineAt = list?.items?.findIndex((i) => i.key === `rs:${mySheet.id}`) ?? -1;
  const foreignAt = list?.items?.findIndex((i) => i.key === `rs:${foreignSheet.id}`) ?? -1;
  check("У списку є свій лист", mineAt >= 0, mineAt);
  check("У списку є чужий лист", foreignAt >= 0, foreignAt);
  check("Свій лист стоїть вище чужого", mineAt >= 0 && foreignAt >= 0 && mineAt < foreignAt, {
    свій: mineAt,
    чужий: foreignAt,
  });

  await cleanup();
  const leftovers = await p.user.count({ where: { email: { startsWith: MARK } } });
  check("Тимчасові дані прибрано", leftovers === 0, leftovers);

  await p.$disconnect();
  console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ПАДІННЯ:", e);
  await cleanup().catch(() => {});
  await p.$disconnect();
  process.exit(1);
});
