/**
 * Робочі дні водіїв — «Логістика → Зміни → Водії».
 *
 * Водій зміну не відкриває: його трек пише робоча збірка від входу в
 * застосунок, тож `TrackPoint.shiftId` у нього порожній, і список змін
 * торгових його не бачить. Робочий день водія — пара «людина + київська
 * доба», і зводиться він із трьох джерел:
 *
 *   трек (TrackSession / TrackPoint) — скільки проїхав насправді;
 *   маршрут сайту або лист 1С        — скільки планували і скільки внесли фактом;
 *   відмітки (Visit)                 — скільки точок закрито і скільки грошей забрано.
 *
 * Схема бази для цього не змінювалась — усе вже лежить у наявних таблицях.
 * Кешування пробігу — справа роуту: модуль без імпортів next/*.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { onlyWorkingHours } from "@/lib/track/work-hours";
import { trackKmFromPoints, type ShiftTrackKm } from "@/lib/shift/service";
import { loadPayrollRows } from "@/lib/drivers/payroll-facts";

/**
 * Найдовший період за один запит. Кожен день тягне всі свої точки (тисячі
 * рядків через інтернет до бази), і квартал за раз — це хвилина очікування.
 */
export const DRIVER_DAYS_MAX_DAYS = 31;

/** Скільки днів рахувати одночасно: не заливати базу десятком важких вибірок разом. */
const KM_CONCURRENCY = 3;

export type DriverDaySheet = {
  id: string;
  number: string;
  /** SITE — маршрут планувальника, SHEET_1C — лист з обміну */
  source: "SITE" | "SHEET_1C";
  /** Плановий пробіг OSRM — лише в маршруту сайту */
  plannedKm: number | null;
  /** Факт: введений офісом (сайт) або кілометраж із листа 1С; null — не внесено */
  factKm: number | null;
  /** Унікальні адреси — так само, як рахує їх кабінет водія */
  stops: number;
};

export type DriverDay = {
  driverId: string;
  name: string;
  /** Київська доба «2026-09-12» */
  day: string;
  /** null — того дня точок не було взагалі */
  track: {
    pointsCount: number;
    firstAt: string;
    lastAt: string | null;
    /** Пробіг у робочі години; null — довірених точок замало */
    km: ShiftTrackKm | null;
  } | null;
  sheets: DriverDaySheet[];
  plannedKm: number | null;
  factKm: number | null;
  stops: number;
  visits: { done: number; missed: number; collected: number };
};

export type DriverDaysResult = {
  from: string;
  to: string;
  /** Початок періоду обрізано до останніх DRIVER_DAYS_MAX_DAYS днів */
  truncated: boolean;
  days: DriverDay[];
};

/** Пробіг сесії; роут підміняє його кешованою версією. */
export type SessionKmFn = (sessionId: string, pointsCount: number) => Promise<ShiftTrackKm | null>;

/**
 * Пробіг доби за кермом — у тих самих робочих годинах, що показує карта дня,
 * і тією самою арифметикою, що зміна торгового (`trackKmFromPoints`).
 */
export async function sessionDriveKm(sessionId: string): Promise<ShiftTrackKm | null> {
  const points = await prisma.trackPoint.findMany({
    where: { sessionId },
    orderBy: { recordedAt: "asc" },
    select: {
      lat: true,
      lng: true,
      accuracyM: true,
      recordedAt: true,
      roadMetersFromPrev: true,
      speedKmh: true,
    },
  });
  return trackKmFromPoints(onlyWorkingHours(points));
}

/** «2026-09-12» ± N діб. Опівдні UTC, щоб перехід на літній час не зсунув дату. */
function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

function sumOrNull(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v != null);
  return known.length ? Math.round(known.reduce((sum, v) => sum + v, 0) * 10) / 10 : null;
}

async function inBatches<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function loadDriverDays(
  fromDay: string,
  toDay: string,
  opts: { driverId?: string | null; sessionKm?: SessionKmFn } = {}
): Promise<DriverDaysResult> {
  // Майбутнє відрізаємо: 1С виписує лист на завтра, але робочим днем він
  // стане лише завтра.
  const today = kyivDate(new Date());
  const to = toDay > today ? today : toDay;
  // Обрізаємо початок, а не кінець: свіжі дні цікавіші за давні.
  const earliest = shiftDay(to, -(DRIVER_DAYS_MAX_DAYS - 1));
  const from = fromDay < earliest ? earliest : fromDay;
  const truncated = from !== fromDay;
  if (from > to) return { from, to, truncated, days: [] };

  const fromDate = kyivDayStart(from);
  const toDate = kyivDayEnd(to);
  const driverId = opts.driverId ?? null;
  const computeKm: SessionKmFn = opts.sessionKm ?? ((id) => sessionDriveKm(id));

  const [drivers, sheets] = await Promise.all([
    prisma.user.findMany({
      where: { role: "DRIVER", ...(driverId ? { id: driverId } : {}) },
      select: { id: true, name: true },
    }),
    // Те саме джерело, що й зарплата: маршрути сайту (без чернеток), а листи
    // 1С лише на дні без маршруту сайту — інакше день задвоївся б.
    loadPayrollRows(fromDate, toDate, driverId),
  ]);

  // Водій — це роль DRIVER або людина, на яку виписано лист: акаунт з іншою
  // роллю, що возить листи, інакше випав би зі списку разом зі своїми днями.
  const names = new Map<string, string>(drivers.map((d) => [d.id, d.name ?? "Без імені"]));
  for (const s of sheets) {
    if (s.driverId && !names.has(s.driverId)) names.set(s.driverId, s.driverName ?? "Без імені");
  }
  const ids = [...names.keys()];
  if (ids.length === 0) return { from, to, truncated, days: [] };

  const [sessions, visits] = await Promise.all([
    prisma.trackSession.findMany({
      where: { userId: { in: ids }, day: { gte: fromDate, lte: toDate }, pointsCount: { gt: 0 } },
      select: { id: true, userId: true, day: true, pointsCount: true, startedAt: true, lastPointAt: true },
    }),
    prisma.visit.findMany({
      where: { userId: { in: ids }, day: { gte: fromDate, lte: toDate } },
      select: { userId: true, day: true, status: true, collectedAmount: true },
    }),
  ]);

  const rows = new Map<string, DriverDay>();
  const rowFor = (userId: string, day: string): DriverDay => {
    const key = `${userId}|${day}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        driverId: userId,
        name: names.get(userId) ?? "Без імені",
        day,
        track: null,
        sheets: [],
        plannedKm: null,
        factKm: null,
        stops: 0,
        visits: { done: 0, missed: 0, collected: 0 },
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const s of sheets) {
    // Неприв'язаний лист видно в «Налаштуваннях» водіїв; днем водія він не є.
    if (!s.driverId) continue;
    // Лічильник точок — унікальні адреси, як у кабінеті водія: кілька
    // накладних на одного клієнта — одна зупинка.
    const unique = new Set(s.stops.map((st) => st.counterpartyId ?? `addr:${st.address ?? st.id}`));
    rowFor(s.driverId, kyivDate(s.date)).sheets.push({
      id: s.id,
      number: s.number,
      source: s.source,
      plannedKm: s.plannedKm,
      factKm: s.source === "SITE" ? s.actualKm : s.distanceKm > 0 ? s.distanceKm : null,
      stops: unique.size,
    });
  }

  const kms = await inBatches(sessions, KM_CONCURRENCY, (s) => computeKm(s.id, s.pointsCount));
  sessions.forEach((s, i) => {
    rowFor(s.userId, kyivDate(s.day)).track = {
      pointsCount: s.pointsCount,
      firstAt: s.startedAt.toISOString(),
      lastAt: s.lastPointAt?.toISOString() ?? null,
      km: kms[i],
    };
  });

  for (const v of visits) {
    const row = rowFor(v.userId, kyivDate(v.day));
    if (v.status === "DONE") row.visits.done += 1;
    else row.visits.missed += 1;
    row.visits.collected += v.collectedAmount ?? 0;
  }

  for (const row of rows.values()) {
    row.plannedKm = sumOrNull(row.sheets.map((s) => s.plannedKm));
    row.factKm = sumOrNull(row.sheets.map((s) => s.factKm));
    row.stops = row.sheets.reduce((n, s) => n + s.stops, 0);
  }

  const days = [...rows.values()].sort(
    (a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name, "uk")
  );
  return { from, to, truncated, days };
}
