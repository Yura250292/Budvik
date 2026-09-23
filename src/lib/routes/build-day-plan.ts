/**
 * План доставки на день: хто що везе і в якому порядку.
 *
 * Нічого не зберігає — складає й віддає. Запис робить окремий виклик
 * `apply`, як і в парі optimize-day / apply-order: інакше «подивитися,
 * скільки коштує» вже міняло б завтрашній день водія.
 *
 * Розподіл рахує ядро plan-day.ts по прямій, а кілометри й порядок — OSRM,
 * уже по дорозі. Розділення навмисне: пряма годиться, щоб зрозуміти
 * напрямок, і не годиться, щоб називати число людині.
 *
 * Поле `fixed` — це «перерахуй порядок, склад я вже поправив»: менеджер
 * перетягнув точки на карті й хоче свіжі кілометри, а не новий розподіл.
 * Без нього кожне перетягування скасовувало б попередні правки.
 */

import { prisma } from "@/lib/prisma";
import { defaultDepot } from "@/lib/routes/depot";
import { planCandidates, type PlanCandidate } from "@/lib/routes/plan-candidates";
import { deliveryHabits, DEFAULT_MAX_STOPS } from "@/lib/routes/delivery-habits";
import { planDay, DEFAULT_PLAN_OPTIONS, type PlanPoint, type PlanDriver, type PlanRoute } from "@/lib/routes/plan-day";
import { optimizeRoute, type FuelParams, type OptimizeStop } from "@/lib/routes/optimize";
import { scoreClient } from "@/lib/routes/priority";
import { agingByCounterparty } from "@/lib/analytics/money-facts";
import { colorForRep } from "@/lib/routes/colors";

/** Типове авто розвозки — те саме, що в optimize-day. */
const DEFAULT_FUEL: FuelParams = { consumption: 12, pricePerUnit: 56, bufferPercent: 10 };

/** Кого вважаємо «сьогоднішніми» водіями, якщо менеджер не назвав склад. */
const ACTIVE_DRIVER_DAYS = 14;

export type PlanStopOut = {
  salesDocumentId: string;
  counterpartyId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  amount: number;
  sequence: number;
  /** Клієнт ніколи не був у маршрутному листі — схоже, забирає сам */
  neverDelivered: boolean;
};

export type PlanRouteOut = {
  driverId: string;
  driverName: string;
  color: string;
  stops: PlanStopOut[];
  distanceKm: number | null;
  durationMin: number | null;
  fuelCost: number | null;
  geometry: GeoJSON.LineString | null;
  reason: string;
  /** Порядок дала пряма, а не дорога: OSRM не відповів */
  orderFromDistance: boolean;
  /**
   * Звична денна норма цього водія, км (медіана по його листах) — або null,
   * коли історії немає. Потрібна, щоб людина бачила довгий маршрут як довгий:
   * норми різняться вдвічі, і 300 км для одного водія буденність, а для
   * іншого — півтори норми.
   */
  normalKm: number | null;
};

export type PlanWaiting = {
  salesDocumentId: string;
  /**
   * Номер документа — те, за чим людина знайде його в 1С.
   *
   * Для документа без контрагента це ЄДИНА зачіпка: ні імені, ні адреси в
   * нього немає, а технічний ідентифікатор у 1С не шукається.
   */
  number: string;
  counterpartyId: string;
  name: string;
  address: string | null;
};

export type PlanDayResponse = {
  date: string;
  depot: { lat: number; lng: number; name: string } | null;
  drivers: Array<{ id: string; name: string; color: string; maxStops: number }>;
  routes: PlanRouteOut[];
  deferred: Array<{ points: PlanStopOut[]; reason: string; suggestWeekday: number | null }>;
  noPin: PlanWaiting[];
  outOfZone: PlanWaiting[];
  /** Документи без контрагента — пін ставити нема кому, дивитись у 1С */
  noCounterparty: PlanWaiting[];
  /** Внутрішні: склад, співробітники, торгові. Не розвозка, але видно, що вони є */
  internal: PlanWaiting[];
  notes: string[];
};

export type BuildDayPlanInput = {
  date: string;
  /** Кого саме ставимо на день; без цього — усі, хто возив за два тижні */
  driverIds?: string[];
  /** salesDocumentId → driverId: точка їде попри будь-яку арифметику */
  pins?: Record<string, string>;
  /** Документи, які менеджер прибрав з плану */
  exclude?: string[];
  /** Готовий склад маршрутів: розподіл не чіпаємо, рахуємо лише порядок і км */
  fixed?: Array<{ driverId: string; salesDocumentIds: string[] }>;
};

function waiting(c: PlanCandidate): PlanWaiting {
  return {
    salesDocumentId: c.salesDocumentId,
    number: c.number,
    counterpartyId: c.counterpartyId,
    name: c.name,
    address: c.address,
  };
}

export async function buildDayPlan(input: BuildDayPlanInput): Promise<PlanDayResponse | { error: string }> {
  const notes: string[] = [];

  const depot = await defaultDepot();
  if (!depot) return { error: "У базі немає складу з координатами — нема звідки виїжджати" };

  /* ── Кандидати ─────────────────────────────────────────────────────── */

  const candidates = await planCandidates();
  const exclude = new Set(input.exclude ?? []);
  const usable = candidates.points.filter((c) => !exclude.has(c.salesDocumentId));

  // Документ без контрагента менеджер не в змозі ні поставити на карту, ні
  // оцінити — але й мовчати про нього не можна, інакше він просто зникає
  // з поля зору (LEFT JOIN у plan-candidates.ts навмисно не губить рядок).
  if (candidates.noCounterparty.length > 0) {
    notes.push(`${candidates.noCounterparty.length} документів без контрагента — їх видно лише в 1С`);
  }

  const habits = await deliveryHabits();

  if (usable.length === 0) {
    return {
      date: input.date,
      depot,
      drivers: [],
      routes: [],
      deferred: [],
      noPin: candidates.noPin.map(waiting),
      outOfZone: candidates.outOfZone.map(waiting),
      noCounterparty: candidates.noCounterparty.map(waiting),
      internal: candidates.internal.map(waiting),
      notes: [...notes, "Непривезених реалізацій з координатами не знайшлося"],
    };
  }

  /* ── Водії ─────────────────────────────────────────────────────────── */

  const since = new Date(Date.now() - ACTIVE_DRIVER_DAYS * 86_400_000);

  let driverRows: Array<{ id: string; name: string; color: string | null }>;

  if (input.driverIds?.length) {
    driverRows = await prisma.user.findMany({
      where: { id: { in: input.driverIds } },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    });
  } else {
    /*
     * Хто возив за останні два тижні — за листами, а не за прив'язкою в них.
     *
     * Прямий фільтр `routeSheets: { some: … }` спирається на RouteSheet.driverId,
     * який обмін проставляє не завжди: 23.09.2026 з трьох водіїв, що реально
     * їздили, прив'язаний був лише Піцишин, і план роздав йому всі 24 точки, а
     * 98 поклав у відкладені — при живих Пайді й Ткаченку. Тому зіставляємо
     * так само, як профілі: спершу прив'язка, далі Ref_Key 1С, далі ім'я.
     */
    const sheets = await prisma.routeSheet.findMany({
      where: { date: { gte: since } },
      select: { driverId: true, driverExternalId1C: true, driverName1C: true },
    });

    const staff = await prisma.user.findMany({
      where: { role: "DRIVER" },
      select: { id: true, name: true, color: true, driver1CExternalId: true },
    });

    const byId = new Map(staff.map((u) => [u.id, u]));
    const byRef = new Map(staff.filter((u) => u.driver1CExternalId).map((u) => [u.driver1CExternalId!, u]));
    const byName = new Map(staff.map((u) => [u.name.replace(/\s+/g, " ").trim().toLowerCase(), u]));

    const picked = new Map<string, { id: string; name: string; color: string | null }>();
    const unmatched = new Map<string, number>();

    for (const sheet of sheets) {
      const found =
        (sheet.driverId ? byId.get(sheet.driverId) : undefined) ??
        (sheet.driverExternalId1C ? byRef.get(sheet.driverExternalId1C) : undefined) ??
        (sheet.driverName1C ? byName.get(sheet.driverName1C.replace(/\s+/g, " ").trim().toLowerCase()) : undefined);

      if (found) {
        picked.set(found.id, { id: found.id, name: found.name, color: found.color });
      } else if (sheet.driverName1C) {
        unmatched.set(sheet.driverName1C, (unmatched.get(sheet.driverName1C) ?? 0) + 1);
      }
    }

    // Водій без акаунта — це не наша помилка, але мовчати про неї не можна:
    // його листи є, а поставити йому точки план не може.
    for (const [name, count] of unmatched) {
      notes.push(`${name} возив ${count} лист(ів) за два тижні, але акаунта водія на сайті немає — у план не ставимо`);
    }

    driverRows = [...picked.values()].sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }

  if (driverRows.length === 0) {
    return { error: "Не знайшов водіїв: за два тижні ні в кого немає маршрутних листів" };
  }

  const drivers: PlanDriver[] = driverRows.map((d) => ({
    id: d.id,
    name: d.name,
    maxStops: habits.capacity.get(d.id)?.maxStops ?? DEFAULT_MAX_STOPS,
  }));

  /* ── Важливість точки ──────────────────────────────────────────────── */

  const aging = await agingByCounterparty(usable.map((c) => c.counterpartyId));

  const points: PlanPoint[] = usable.map((c) => {
    const debt = aging.get(c.counterpartyId);
    return {
      id: c.salesDocumentId,
      counterpartyId: c.counterpartyId,
      name: c.name,
      lat: c.lat!,
      lng: c.lng!,
      amount: c.amount,
      score: scoreClient({
        receivable: debt?.debt ?? 0,
        overdue: debt?.overdue ?? 0,
        turnover: 0,
        deliveryAmount: c.amount,
        state: null,
      }),
      pinnedDriverId: input.pins?.[c.salesDocumentId] ?? null,
    };
  });

  const byId = new Map(points.map((p) => [p.id, p]));
  const candById = new Map(usable.map((c) => [c.salesDocumentId, c]));

  /* ── Розподіл: або рахуємо, або беремо готовий ─────────────────────── */

  let planRoutes: PlanRoute[];
  let deferred: ReturnType<typeof planDay>["deferred"] = [];

  if (input.fixed?.length) {
    planRoutes = input.fixed
      .map((f) => ({
        driverId: f.driverId,
        points: f.salesDocumentIds.map((id) => byId.get(id)).filter((p): p is PlanPoint => Boolean(p)),
        reason: "склад визначив менеджер",
      }))
      .filter((r) => r.points.length > 0);

    /*
     * Те, що лишилося поза маршрутами, і далі відкладене.
     *
     * Без цього «Перерахувати порядок» спустошувало секцію «Відкладені» на
     * екрані: у маршрути йшли лише точки з `fixed`, а решта зникала з
     * відповіді зовсім — і менеджер бачив хибну картину «все розподілено»,
     * хоча в базу ще нічого не писалося й документи нікуди не поділися.
     */
    const inRoutes = new Set(input.fixed.flatMap((f) => f.salesDocumentIds));
    const leftOut = points.filter((p) => !inRoutes.has(p.id));
    if (leftOut.length > 0) {
      deferred = [{ points: leftOut, reason: "не увійшло в маршрути після правки складу", suggestWeekday: null }];
    }
  } else {
    // 0 = понеділок, як у профілях.
    const weekday = (new Date(`${input.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const plan = planDay({ points, drivers, habits, depot, options: DEFAULT_PLAN_OPTIONS, weekday });
    planRoutes = plan.routes;
    deferred = plan.deferred;
  }

  /* ── Порядок і кілометри — OSRM ────────────────────────────────────── */

  const toStopOut = (p: PlanPoint, sequence: number): PlanStopOut => {
    const c = candById.get(p.id)!;
    return {
      salesDocumentId: p.id,
      counterpartyId: p.counterpartyId,
      name: p.name,
      address: c.address,
      lat: p.lat,
      lng: p.lng,
      amount: p.amount,
      sequence,
      neverDelivered: !habits.deliveriesByClient.has(p.counterpartyId),
    };
  };

  if (candidates.internal.length > 0) {
    notes.push(
      `${candidates.internal.length} документів на своїх (склад, співробітники) у план не пішли — це не розвозка`
    );
  }

  const routes: PlanRouteOut[] = [];
  for (const r of planRoutes) {
    const driver = driverRows.find((d) => d.id === r.driverId);
    if (!driver) continue;

    const stops: OptimizeStop[] = r.points.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, score: p.score }));

    let order = r.points.map((p) => p.id);
    let distanceKm: number | null = null;
    let durationMin: number | null = null;
    let fuelCost: number | null = null;
    let geometry: GeoJSON.LineString | null = null;
    let orderFromDistance = false;

    try {
      const optimized = await optimizeRoute([depot.lng, depot.lat], stops, DEFAULT_FUEL);
      const variant = optimized.balanced ?? optimized.cheapest;
      order = variant.order;
      distanceKm = variant.distanceKm;
      durationMin = variant.durationMin;
      fuelCost = variant.fuelCost;
      geometry = variant.geometry;
    } catch {
      // OSRM мовчить — порядок лишаємо як дало ядро і кажемо про це вголос.
      // Вигадати кілометраж тут було б найгіршим з можливих рішень.
      orderFromDistance = true;
      notes.push(`Маршрут ${driver.name}: OSRM не відповів, порядок за відстанню, кілометрів немає`);
    }

    const stopsOut = order
      .map((id) => byId.get(id))
      .filter((p): p is PlanPoint => Boolean(p))
      .map((p, i) => toStopOut(p, i + 1));

    const selfPickup = stopsOut.filter((s) => s.neverDelivered).length;
    if (selfPickup > 0) {
      notes.push(`${driver.name}: ${selfPickup} точ. — клієнти, яких у листах ще не було, перевірте, чи не самовивіз`);
    }

    const normalKm = habits.capacity.get(r.driverId)?.medianKm ?? null;
    const p80Km = habits.capacity.get(r.driverId)?.p80Km ?? null;
    if (distanceKm !== null && p80Km !== null && distanceKm > p80Km) {
      notes.push(
        `${driver.name}: ${Math.round(distanceKm)} км — більше за звичні ${Math.round(p80Km)} км його дня; перевірте, чи влізе`
      );
    }

    routes.push({
      driverId: r.driverId,
      driverName: driver.name,
      color: colorForRep(r.driverId, driver.color),
      stops: stopsOut,
      distanceKm,
      durationMin,
      fuelCost,
      geometry,
      reason: r.reason,
      orderFromDistance,
      normalKm,
    });
  }

  return {
    date: input.date,
    depot,
    drivers: driverRows.map((d) => ({
      id: d.id,
      name: d.name,
      color: colorForRep(d.id, d.color),
      maxStops: habits.capacity.get(d.id)?.maxStops ?? DEFAULT_MAX_STOPS,
    })),
    routes,
    deferred: deferred.map((d) => ({
      points: d.points.map((p, i) => toStopOut(p, i + 1)),
      reason: d.reason,
      suggestWeekday: d.suggestWeekday,
    })),
    noPin: candidates.noPin.map(waiting),
    outOfZone: candidates.outOfZone.map(waiting),
    noCounterparty: candidates.noCounterparty.map(waiting),
    internal: candidates.internal.map(waiting),
    notes,
  };
}
