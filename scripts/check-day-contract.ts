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
const STOP_FIELDS = [
  "key", "counterpartyId", "name", "address", "lat", "lng", "geoSource",
  "sequence", "amount", "debtAmount", "kind", "notes", "visit",
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
  await p.routeSheet.create({
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

  const route = body.route as { number?: unknown; stops?: unknown } | null;
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
