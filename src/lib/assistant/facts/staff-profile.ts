/**
 * Людина цілком: торговий, водій або складовщик одним обʼєктом.
 *
 * Питання «розкажи про Кулика» — це не одна метрика, а розмова про
 * людину: скільки продає, яке місце в команді, чи росте, чи збирає гроші,
 * хто йому винен, скільки їздить, де він зараз. Усе це вже рахує адмінка
 * в різних розділах; тут ті самі функції викликаються разом, щоб помічник
 * називав ті самі числа, що й екрани, — інакше два джерела почнуть
 * сперечатися, і довіри не буде до жодного.
 *
 * Гілка обирається за РОЛЛЮ, а не за питанням: продажів ні на водія, ні
 * на складовщика не оформлюють, портфеля в них немає, а в торгового немає
 * маршрутних листів. Показати водієві «оборот 0, місце —» означало б
 * видати порожній звіт за факт.
 *
 * ЩО ТУТ СВІДОМО ЗРОБЛЕНО:
 * • списки (боржники, бренди, листи, накладні) обрізані до кількох рядків
 *   і вимикаються зовсім, коли профілів два — інакше JSON не влізе в
 *   контекст моделі;
 * • медіани команди віддаються поруч: «400 тис.» без «а в команді 300»
 *   — не оцінка, а просто число;
 * • де порівняти нема з чим (динаміка без історії, прогноз поза поточним
 *   місяцем, відмітки збірки, яких у проді ще немає), стоїть null або
 *   примітка, а не нуль.
 */

import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/analytics/period";
import { ROLE_WORD, type Staff, type StaffRole } from "@/lib/assistant/facts/staff";
import { pct, uah, ymd } from "@/lib/assistant/format";
import { kyivDate, kyivTime } from "@/lib/date/kyiv";
import { teamBenchmark, type TeamBenchmark } from "@/lib/analytics/benchmark";
import { METRICS, type MetricKey } from "@/lib/analytics/benchmarkMetrics";
import { repTrend } from "@/lib/analytics/trends";
import { clientPortfolio } from "@/lib/analytics/clients";
import {
  collectedByRepBrand,
  collectedTotals,
  receivableRowsByRep,
  sumAging,
  toDebtorList,
} from "@/lib/analytics/money-facts";
import { fuelCost, NO_SHIFTS, revenueByRepBrand, shiftFactsByUser } from "@/lib/analytics/facts";
import { payerVerdicts, verdictLabel } from "@/lib/assistant/facts/discipline-cache";
import { monthForecast } from "@/lib/assistant/facts/forecast";
import { returnsFacts } from "@/lib/assistant/facts/returns";
import { livePositions, type LivePerson } from "@/lib/track/live-positions";
import { driverEfficiencyFacts, type DriverEfficiencyReport } from "@/lib/drivers/efficiency-facts";
import { buildDriverFacts, getRates, loadBonuses } from "@/lib/drivers/payroll-facts";
import { calculateDriverPeriod } from "@/lib/drivers/payroll";
import { driverDayFacts } from "@/lib/assistant/facts/driver-day";
import { warehouseActivity, type WarehouseActivity } from "@/lib/assistant/facts/warehouse-activity";

/** Стелі списків — щоб профіль лишався в межах ~9 тис. символів. */
const DEBTORS_LIMIT = 5;
const BRANDS_LIMIT = 8;
const SHEETS_LIMIT = 10;
const MISMATCH_LIMIT = 5;

export type StaffProfile = {
  особа: Record<string, unknown>;
  /** Медіани команди тієї самої ролі; null — команди для порівняння немає. */
  медіани: Record<string, unknown> | null;
  примітка: string;
};

/**
 * Командні звіти, які можна порахувати один раз на кілька профілів.
 *
 * Порівняння двох людей інакше рахувало б бенчмарк усієї команди двічі —
 * а це найдорожчий запит у профілі торгового.
 */
export type TeamReports = {
  benchmark?: TeamBenchmark;
  drivers?: DriverEfficiencyReport;
  warehouse?: WarehouseActivity;
};

export type StaffProfileOptions = {
  /** false — без списків (боржники, бренди, листи, накладні). */
  lists?: boolean;
  team?: TeamReports;
};

/** Командний звіт для ролі — щоб інструмент порахував його раз на порівняння. */
export async function teamReportFor(role: StaffRole, period: Period): Promise<TeamReports> {
  if (role === "SALES") return { benchmark: await teamBenchmark(period) };
  if (role === "DRIVER") return { drivers: await driverEfficiencyFacts(period.from, period.to) };
  return { warehouse: await warehouseActivity(period, null) };
}

export async function staffProfile(
  user: Staff,
  period: Period,
  today: string,
  options: StaffProfileOptions = {}
): Promise<StaffProfile> {
  const lists = options.lists ?? true;
  const team = options.team ?? {};

  if (user.role === "SALES") return salesProfile(user, period, today, lists, team);
  if (user.role === "DRIVER") return driverProfile(user, period, today, lists, team);
  return warehouseProfile(user, period, lists, team);
}

/* ── Спільні шматки ───────────────────────────────────────────────────── */

const round1 = (n: number) => Math.round(n * 10) / 10;

/** null лишається null: «нема з чого порахувати» ≠ 0. */
const nz = <T>(v: number | null | undefined, f: (n: number) => T): T | null =>
  v == null || !Number.isFinite(v) ? null : f(v);

/** Що каже трек просто зараз — спільне для торгового й водія. */
function nowBlock(person: LivePerson | undefined) {
  if (!person) return null;
  return {
    зміна: person.shift
      ? {
          стан: person.shift.status === "OPEN" ? "відкрита" : "закрита",
          відкрита_о: kyivTime(person.shift.startedAt),
          закрита_о: person.shift.endedAt ? kyivTime(person.shift.endedAt) : null,
        }
      : null,
    останній_сигнал_хв_тому: person.minutesAgo,
    пройдено_км: Math.round(person.distanceKm),
    замовлень_сьогодні: person.ordersToday,
    проблема: person.problem,
  };
}

/** Зміни й пальне за період — так само, як у shifts_report. */
async function shiftsBlock(userId: string, period: Period) {
  const [facts, vehicle] = await Promise.all([
    shiftFactsByUser(period.from, period.to, userId),
    prisma.salesVehicle.findUnique({
      where: { repId: userId },
      select: { label: true, fuelConsumption: true, fuelPricePerL: true },
    }),
  ]);
  const f = facts[0] ?? { userId, ...NO_SHIFTS };
  const fuel = fuelCost(f.workKm, vehicle, f.daysWorked);
  return {
    змін: f.shifts,
    днів: f.daysWorked,
    робочих_км: Math.round(f.workKm),
    gps_км: Math.round(f.gpsKm),
    особистих_км: Math.round(f.personalKm),
    км_лише_за_gps: Math.round(f.gpsOnlyKm),
    підозрілих: f.suspicious,
    відкритих: f.openShifts,
    пальне_л: Math.round(fuel.liters),
    пальне_грн: uah(fuel.cost),
    авто: vehicle?.label ?? null,
  };
}

/* ── Торговий ─────────────────────────────────────────────────────────── */

async function salesProfile(
  user: Staff,
  period: Period,
  today: string,
  lists: boolean,
  team: TeamReports
): Promise<StaffProfile> {
  /**
   * Прогноз місяця має сенс лише для періоду, що закінчується в поточному
   * місяці: «виконання плану» за минулий тиждень — число ні про що.
   */
  const inCurrentMonth = period.toDay.slice(0, 7) === today.slice(0, 7);

  const [bench, trend, forecast, rows, verdicts, collected, returns, shifts, visits, live, brands, portfolio] =
    await Promise.all([
      team.benchmark ?? teamBenchmark(period),
      repTrend(user.id, period),
      inCurrentMonth ? monthForecast(user.id, today) : Promise.resolve(null),
      receivableRowsByRep(user.id),
      payerVerdicts(),
      collectedByRepBrand(period.from, period.to, user.id),
      returnsFacts(user.id, period),
      shiftsBlock(user.id, period),
      prisma.visit.count({ where: { userId: user.id, day: { gte: period.from, lte: period.to } } }),
      livePositions(today),
      revenueByRepBrand(period.from, period.to, user.id),
      clientPortfolio(user.id, period),
    ]);

  const me = bench.reps.find((r) => r.repId === user.id) ?? null;
  const label = (k: MetricKey) => METRICS[k].label;
  const aging = sumAging(rows);
  const money = collectedTotals(collected).get(user.id) ?? { amount: 0, profit: 0 };
  const m = trend.momentum;
  // Відсоток від нульової бази — не темп, а брак історії.
  const momentumPct = (delta: number, base: number) =>
    m.comparable && base > 0 ? pct(delta) : null;

  const brandRows = [...brands]
    .filter((b) => b.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, BRANDS_LIMIT)
    .map((b) => ({ бренд: b.brandName ?? "без бренду", оборот: uah(b.amount), вал: uah(b.profit) }));

  const debtors = toDebtorList(rows)
    .slice(0, DEBTORS_LIMIT)
    .map((d) => ({
      клієнт_id: d.counterpartyId,
      клієнт: d.name,
      борг: uah(d.debt),
      прострочено: uah(d.overdue),
      найстаріше_днів: d.oldestDays,
      платник: verdictLabel(verdicts.verdicts.get(d.counterpartyId)),
      останнє_відвантаження: ymd(d.lastDocAt),
    }));

  const особа = {
    user_id: user.id,
    ім_я: user.name,
    роль: ROLE_WORD.SALES,
    продажі: me
      ? {
          оборот: uah(me.revenue),
          реалізацій: me.docs,
          клієнтів: me.clients,
          середній_чек: uah(me.avgCheck),
          місце: me.place,
          з_торгових: bench.reps.length,
          повернення_відсотків: pct(me.returnRatio),
          sku_на_клієнта: nz(me.skuPerClient, round1),
          брендів: me.brandCount,
          нових_клієнтів: me.newClients,
          втрачених_клієнтів: me.lostClients,
        }
      : null,
    порівняння_можливе: bench.comparable,
    сильне: me ? me.strengths.map(label) : [],
    слабке: me ? me.weaknesses.map(label) : [],
    динаміка: {
      порівнянно: m.comparable,
      вікна: `${m.previousFrom} → ${m.recentFrom} → ${period.toDay}`,
      останні_4_тижні: {
        оборот: uah(m.recent.amount),
        реалізацій: m.recent.docs,
        клієнтів: m.recent.clients,
        середній_чек: uah(m.recent.avgCheck),
      },
      попередні_4_тижні: {
        оборот: uah(m.previous.amount),
        реалізацій: m.previous.docs,
        клієнтів: m.previous.clients,
        середній_чек: uah(m.previous.avgCheck),
      },
      оборот_відсотків: momentumPct(m.amountDeltaPct, m.previous.amount),
      реалізацій_відсотків: momentumPct(m.docsDeltaPct, m.previous.docs),
      чек_відсотків: momentumPct(m.avgCheckDeltaPct, m.previous.avgCheck),
      клієнтів_відсотків: momentumPct(m.clientsDeltaPct, m.previous.clients),
    },
    прогноз_місяця: forecast
      ? {
          місяць: forecast.місяць,
          днів_минуло: forecast.днів_минуло,
          днів_лишилось: forecast.днів_лишилось,
          показники: forecast.показники.map((p) => ({
            назва: p.назва,
            факт: p.факт,
            темп_на_день: p.темп_на_день,
            прогноз: p.прогноз,
            минулий_місяць: p.минулий_місяць,
            зміна_до_минулого_відсотків: p.зміна_до_минулого_відсотків,
            // План — лише коли він заведений: «план 0, виконання 0 %»
            // читається як провал, а означає «порівнювати нема з чим».
            ...(p.план > 0
              ? {
                  план: p.план,
                  виконання_відсотків: p.виконання_відсотків,
                  прогнозоване_виконання_відсотків: p.прогнозоване_виконання_відсотків,
                  треба_на_день: p.треба_на_день,
                  лишилось_добрати: p.лишилось_добрати,
                }
              : {}),
          })),
          бонуси: forecast.бонуси,
          примітка: forecast.примітка,
        }
      : undefined,
    дебіторка: {
      борг: uah(aging.total),
      прострочено: uah(aging.overdue),
      // overdueRatio — уже у відсотках (0..100), другий раз ×100 не треба.
      прострочено_відсотків: pct(aging.overdueRatio),
      старше_за_історію: uah(aging.unknown),
      боржників: rows.length,
      ...(lists ? { боржники: debtors } : {}),
    },
    // Лише сума: вал по рознесеннях у базі здебільшого порожній, і «вал 0»
    // читалося б як «продає без маржі», хоча означає лише брак даних.
    зібрано_грошей: { сума: uah(money.amount) },
    повернення: {
      сума: uah(returns.amount),
      документів: returns.docs,
      частка_відсотків: pct(returns.share),
      медіана_команди_відсотків: pct(returns.teamShare),
      гірших_у_команді: returns.worseThanMe,
      торгових_з_оборотом: returns.teamSize,
    },
    зміни: { ...shifts, візитів_відмічено: visits },
    портфель: {
      усього: portfolio.totalClients,
      нових: portfolio.counts.NEW,
      активних: portfolio.counts.ACTIVE,
      сповзають: portfolio.counts.SLIPPING,
      сплять: portfolio.counts.DORMANT,
      втрачених: portfolio.counts.LOST,
      оборот_нових: uah(portfolio.newRevenue),
      оборот_втрачених: uah(portfolio.lostRevenue),
    },
    ...(lists ? { бренди: brandRows } : {}),
    зараз: nowBlock(live.people.find((p) => p.userId === user.id)),
    // Застереження про САМУ людину живе в ній: у порівнянні двох профілів
    // спільна примітка одна, і чуже «реалізацій немає» губилося б.
    ...(me ? {} : { примітка: "Реалізацій за період немає — місце й продажі не рахуються." }),
  };

  const med = bench.medians;
  const медіани = {
    оборот: nz(med.revenue, uah),
    реалізацій: nz(med.docs, Math.round),
    клієнтів: nz(med.clients, Math.round),
    середній_чек: nz(med.avgCheck, uah),
    зібрано: nz(med.collected, uah),
    прострочено_відсотків: nz(med.overdueRatio, pct),
    повернення_відсотків: nz(med.returnRatio, pct),
    sku_на_клієнта: nz(med.skuPerClient, round1),
    брендів: nz(med.brandCount, Math.round),
    нових_клієнтів: nz(med.newClients, Math.round),
    втрачених_клієнтів: nz(med.lostClients, Math.round),
    динаміка_відсотків: nz(med.momentumPct, pct),
    торгових_у_порівнянні: bench.reps.length,
  };

  return {
    особа,
    медіани,
    примітка:
      "Оборот і місце — ті самі, що в team_overview (у команді й офіс, який виписує документи на себе). Прострочка — оцінка з наших відвантажень, 1С строків не передає. Робочі км — з одометра.",
  };
}

/* ── Водій ────────────────────────────────────────────────────────────── */

async function driverProfile(
  user: Staff,
  period: Period,
  today: string,
  lists: boolean,
  team: TeamReports
): Promise<StaffProfile> {
  const [eff, sheets, bonuses, rates, handovers, day, shifts, live] = await Promise.all([
    team.drivers ?? driverEfficiencyFacts(period.from, period.to),
    buildDriverFacts(user.id, period.from, period.to),
    loadBonuses(period.from, period.to, user.id),
    getRates(),
    prisma.cashHandover.findMany({
      where: { driverId: user.id, day: { gte: period.from, lte: period.to } },
      orderBy: { handedAt: "desc" },
      select: {
        day: true,
        amount: true,
        expectedAmount: true,
        handedAt: true,
        confirmedAt: true,
        confirmedAmount: true,
      },
    }),
    driverDayFacts(user.id, today),
    shiftsBlock(user.id, period),
    livePositions(today),
  ]);

  const me = eff.drivers.find((d) => d.driverId === user.id) ?? null;
  const payroll = calculateDriverPeriod(user.id, sheets, bonuses, rates);

  /**
   * Лист 1С — це лише шапка: ні сум замовлень, ні боргів у ньому немає
   * (точки живуть у друкованій формі). Тож коли всі листи звідти,
   * «привезено обороту 0» — не факт про водія, а дірка в даних, і про
   * це треба сказати словами, а не числом.
   */
  const onlyOneC = sheets.length > 0 && sheets.every((s) => s.source === "SHEET_1C");

  // Застереження про САМУ людину — у ній (див. salesProfile).
  const personal = [
    me ? null : "Маршрутних листів за період немає — ефективність не рахується.",
    onlyOneC
      ? "Усі листи — з 1С, а лист 1С це лише шапка без сум замовлень і боргів: «привезено обороту 0» і «сума замовлень 0» — брак даних, а не факт."
      : null,
    shifts.змін === 0 ? "Змін у застосунку за період немає — водій може ще не працювати з планшетом." : null,
  ].filter((s): s is string => !!s);

  // Здачі каси: заявлено водієм, підтверджено офісом, і де вони розійшлися.
  const confirmed = handovers.filter((h) => h.confirmedAt);
  const pending = handovers.filter((h) => !h.confirmedAt);
  const officeMismatch = confirmed.filter(
    (h) => h.confirmedAmount != null && Math.abs(h.confirmedAmount - h.amount) >= 1
  );
  const lessThanOnHands = handovers.filter(
    (h) => h.expectedAmount != null && h.expectedAmount - h.amount >= 1
  );

  const особа = {
    user_id: user.id,
    ім_я: user.name,
    роль: ROLE_WORD.DRIVER,
    маршрути: me
      ? {
          листів: me.sheets,
          листів_без_пробігу: me.sheetsWithoutKm,
          км: Math.round(me.totalKm),
          км_проти_плану_відсотків: nz(me.kmVsPlanPct, pct),
          точок_місто: me.cityPoints,
          точок_область: me.oblastPoints,
          точок_разом: me.points,
          привезено_обороту: uah(me.deliveredTurnover),
          зарплата: uah(me.payrollTotal),
          зарплата_від_обороту_відсотків: nz(me.payrollToTurnoverPct, pct),
          грн_на_точку: nz(me.costPerPoint, uah),
          км_на_точку: nz(me.kmPerPoint, round1),
          інкасація: {
            відмітки_планшета: uah(me.incasation.collectedVisits),
            борги_в_листах: uah(me.incasation.sheetsDebts),
          },
          підозрілих_змін: me.anomalies.suspiciousShifts,
          автозакритих_змін: me.anomalies.autoClosedShifts,
          листів_понад_план: me.anomalies.kmOverPlan,
        }
      : null,
    зарплата: {
      за_листи: uah(payroll.sheetsTotal),
      бонуси: uah(payroll.bonusesTotal),
      разом: uah(payroll.total),
      листів: payroll.sheetsCount,
      км: Math.round(payroll.totalKm),
      база_відсотка: uah(payroll.turnoverBase),
    },
    ...(lists
      ? {
          // Останні листи першими: питають «як він зараз», а не «як починав».
          листи: [...payroll.sheets]
            .reverse()
            .slice(0, SHEETS_LIMIT)
            .map((s) => ({
              день: s.facts.day,
              номер: s.facts.number,
              джерело: s.facts.source === "SHEET_1C" ? "лист 1С" : "маршрут сайту",
              км: Math.round(s.facts.distanceKm),
              точок: s.facts.cityPoints + s.facts.oblastPoints,
              сума_замовлень: uah(s.facts.ordersTotal),
              борги_в_листі: uah(s.facts.debtsTotal),
              заробіток: uah(s.total),
            })),
          бонуси: payroll.bonusLines.map((b) => ({ за_що: b.label, сума: uah(b.amount) })),
        }
      : {}),
    каса: {
      здач: handovers.length,
      заявлено: uah(handovers.reduce((s, h) => s + h.amount, 0)),
      підтверджено: uah(confirmed.reduce((s, h) => s + (h.confirmedAmount ?? h.amount), 0)),
      очікує_підтвердження: uah(pending.reduce((s, h) => s + h.amount, 0)),
      з_розбіжністю_офісу: officeMismatch.length,
      менше_ніж_на_руках: lessThanOnHands.length,
      ...(lists
        ? {
            розбіжності: officeMismatch.slice(0, MISMATCH_LIMIT).map((h) => ({
              день: kyivDate(h.day),
              заявлено: uah(h.amount),
              прийнято: uah(h.confirmedAmount),
              різниця: uah((h.confirmedAmount ?? 0) - h.amount),
            })),
          }
        : {}),
    },
    сьогодні: {
      маршрут: {
        джерело:
          day.route.source === "ROUTE_SHEET"
            ? "маршрутний лист 1С"
            : day.route.source === "DELIVERY_ROUTE"
              ? "маршрут із сайту"
              : "маршруту немає",
        номер: day.route.number,
        авто: day.route.vehicle,
        план_км: nz(day.route.plannedKm, Math.round),
      },
      точок: day.totals.stops,
      відмічено: day.totals.done,
      товару_на: uah(day.totals.amount),
      забрати_грошей: uah(day.totals.debt),
      каса: {
        зібрано: uah(day.cash.collected),
        здано: uah(day.cash.handed),
        на_руках: uah(day.cash.onHands),
      },
    },
    зміни: shifts,
    зараз: nowBlock(live.people.find((p) => p.userId === user.id)),
    ...(personal.length > 0 ? { примітка: personal.join(" ") } : {}),
  };

  const медіани = {
    грн_на_точку: nz(eff.medians.costPerPoint, uah),
    км_на_точку: nz(eff.medians.kmPerPoint, round1),
    зарплата_від_обороту_відсотків: nz(eff.medians.payrollToTurnoverPct, pct),
    водіїв_у_порівнянні: eff.drivers.length,
  };

  return {
    особа,
    медіани,
    примітка:
      "Зарплата — за маршрутними листами сайту; лист із 1С без маршруту платить нижній тір, майбутні дні не платяться. Каса — здачі водія за період; підтверджує офіс.",
  };
}

/* ── Складовщик ───────────────────────────────────────────────────────── */

async function warehouseProfile(
  user: Staff,
  period: Period,
  lists: boolean,
  team: TeamReports
): Promise<StaffProfile> {
  /**
   * Без списків досить командного зрізу (він уже містить рядок людини);
   * розкладка по накладних є лише в персональному виклику.
   */
  const act = lists ? await warehouseActivity(period, user.id) : (team.warehouse ?? (await warehouseActivity(period, null)));
  const me = act.працівники.find((w) => w.user_id === user.id);

  const особа = {
    user_id: user.id,
    ім_я: user.name,
    роль: ROLE_WORD.WAREHOUSE,
    збірка: me
      ? {
          документів: me.документів,
          рядків: me.рядків,
          штук: me.штук,
          днів_з_відмітками: me.днів_з_відмітками,
          документів_на_день: me.документів_на_день,
          хв_на_документ: me.хв_на_документ,
          перша_відмітка_в_середньому: me.перша_відмітка_в_середньому,
          остання_відмітка_в_середньому: me.остання_відмітка_в_середньому,
        }
      : null,
    звітів_фото: me?.звітів_фото ?? { прочитано: 0, читається: 0, не_вийшло: 0 },
    зміни: me ? { змін: me.змін, годин: me.годин } : null,
    зараз_на_зміні: me?.зараз_на_зміні ?? null,
    ...(lists && act.документи ? { документи: act.документи } : {}),
  };

  return {
    особа,
    медіани: act.медіани,
    примітка: act.примітка,
  };
}
