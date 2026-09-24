/**
 * Поїздки торгових по днях: скільки проїхав, що зробив і чи окупився день.
 *
 * shifts_report давав підсумок людини за період — кілометри й пальне. Для
 * питань керівника цього мало: «хто їздить без толку», «де розходиться
 * одометр із треком», «скільки валу приносить кілометр» — це питання про
 * ДЕНЬ, де поруч стоять пробіг (одометр з фото й трек планшета), відмітки
 * візитів і продажі того ж дня.
 *
 * Джерела ті самі, що вже показують екрани, щоб числа не розходилися:
 * - одометр і трек — Shift (як shiftFactsByUser: день = київська дата
 *   відкриття зміни, беремо всі статуси);
 * - візити — Visit (DONE / MISSED) того ж дня;
 * - продажі й вал — SalesDocument торгового за київською датою документа,
 *   тим самим фільтром і тією самою формулою валу, що й revenueByRep.
 *
 * Продажі дня — усі документи торгового за ту дату, зокрема й телефонні.
 * Відокремити «привезене з поїздки» дані 1С не дозволяють; для оцінки
 * віддачі дня цього досить, і так це й підписано в інструменті.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivDaySql } from "@/lib/date/kyiv";
import { fuelCost, SOURCE_FILTER, SALES_ONLY } from "@/lib/analytics/facts";

/** Одна людина, один київський день — сирі факти з бази. */
export type TripDayFacts = {
  userId: string;
  day: string;
  shifts: number;
  /** Сума Shift.distanceKm; null — жодна зміна дня не має одометра */
  odometerKm: number | null;
  /**
   * Трек (з 05.09.2026 — лише їзда) змін, що МАЮТЬ одометр: пара до
   * odometerKm для відношення. null — треку в цих змінах немає.
   */
  gpsKm: number | null;
  /**
   * Трек змін без одометра (закрили без фото). Окремо, як gpsOnlyKm у
   * shiftFactsByUser: у парі з одометром він дав би «трек довший» на рівному
   * місці, а мовчки зникнути теж не має — день за кермом не нуль.
   */
  gpsOnlyKm: number;
  personalKm: number;
  suspicious: number;
  autoClosed: number;
  visitsDone: number;
  visitsMissed: number;
  collected: number;
  salesAmount: number;
  salesDocs: number;
  salesClients: number;
  /** Вал по документах з відомою собівартістю */
  margin: number;
  /** Сума документів з відомою собівартістю — знаменник для чесного відсотка */
  costedAmount: number;
};

export type TripDay = TripDayFacts & {
  fuel: number | null;
  defaultVehicle: boolean;
  /** Вал з оцінкою частини без собівартості; null — собівартість невідома */
  marginEst: number | null;
  fuelShareOfMarginPct: number | null;
  marginPerKm: number | null;
  kmPerVisit: number | null;
  odometerToGps: number | null;
  flags: string[];
};

/**
 * Вилка «одометр / трек» — та сама, що на екрані змін (ShiftsTab): з
 * 05.09.2026 обидва числа міряють лише їзду, і норма близько одиниці.
 */
export const ODO_GPS_MIN = 0.8;
export const ODO_GPS_MAX = 1.3;

/** Від скількох км день вважається виїздом, а не «заскочив на склад». */
export const TRIP_MIN_KM = 30;

/** Пальне понад таку частку валу — день, який варто розібрати. */
export const FUEL_SHARE_ALERT_PCT = 33;

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Розбір дня: пальне, віддача кілометра й прапорці «подивись».
 *
 * `marksVisits` — чи людина взагалі веде відмітки візитів за період. Станом
 * на вересень 2026 торгові їх не ставлять зовсім (заїзди видно лише з треку
 * на екрані зміни), і прапорець «без візитів» тоді горів би на кожному дні,
 * топлячи справжні сигнали. Тож він лише для тих, у кого відмітки є.
 */
export function tripDay(
  f: TripDayFacts,
  vehicle: { fuelConsumption: number; fuelPricePerL: number } | null,
  opts: { marksVisits?: boolean } = {}
): TripDay {
  const marksVisits = opts.marksVisits ?? true;
  // Пальне — лише з одометра, як у shifts_report: трек його перевіряє, а не
  // заміняє. Без фото одометра кілометрів для грошей немає.
  const fuel = f.odometerKm === null ? null : fuelCost(f.odometerKm, vehicle).cost;

  const marginEst =
    f.costedAmount > 0 ? f.margin + (f.salesAmount - f.costedAmount) * (f.margin / f.costedAmount) : null;

  const odo = f.odometerKm;
  const odometerToGps = odo !== null && f.gpsKm !== null && f.gpsKm > 0 ? round2(odo / f.gpsKm) : null;

  const flags: string[] = [];
  if (f.shifts > 0 && odo === null) flags.push("зміна без одометра — пального не рахуємо");
  if (odo !== null && odo >= TRIP_MIN_KM && (f.gpsKm === null || f.gpsKm === 0 || (odometerToGps ?? 0) > ODO_GPS_MAX)) {
    flags.push("кілометри в одометрі є, а треку до них немає: запис уривався або планшет стояв");
  }
  if (odometerToGps !== null && odometerToGps < ODO_GPS_MIN) {
    flags.push("трек довший за одометр: шумний приймач або неправильний одометр");
  }
  if (marksVisits && odo !== null && odo >= TRIP_MIN_KM && f.visitsDone === 0) flags.push("їздив, а відміток візитів немає");
  if (odo !== null && odo >= TRIP_MIN_KM && f.salesDocs === 0) flags.push("за день жодного продажу");
  const fuelShare = fuel !== null && marginEst !== null && marginEst > 0 ? round1((fuel / marginEst) * 100) : null;
  // Текст сталий, відсоток — у полі дня: так однакові випадки складаються в
  // зведенні «що найчастіше», а не розсипаються на «37,8 %», «40,4 %»…
  if (fuelShare !== null && fuelShare > FUEL_SHARE_ALERT_PCT) flags.push("пальне з'їло понад третину валу дня");
  if (f.suspicious > 0) flags.push("підозрілий одометр");
  if (f.autoClosed > 0) flags.push("зміну закрито автоматично");

  return {
    ...f,
    fuel,
    defaultVehicle: vehicle === null,
    marginEst,
    fuelShareOfMarginPct: fuelShare,
    marginPerKm: marginEst !== null && odo !== null && odo > 0 ? Math.round(marginEst / odo) : null,
    kmPerVisit: odo !== null && f.visitsDone > 0 ? round1(odo / f.visitsDone) : null,
    odometerToGps,
    flags,
  };
}

/**
 * Факти днів за період: одна людина — один рядок на кожен день зі зміною.
 *
 * Дні без зміни сюди не потрапляють навмисно: це розбір поїздок, а продажі
 * «з офісу» без виїзду лишаються в sales_analysis.
 */
export async function repTripDays(from: Date, to: Date, userId?: string | null): Promise<TripDayFacts[]> {
  const userCondition = userId ? Prisma.sql`AND s."userId" = ${userId}` : Prisma.empty;
  const shiftDay = Prisma.raw(kyivDaySql('s."startedAt"'));
  const visitDay = Prisma.raw(kyivDaySql("v.day"));
  const docDay = Prisma.raw(kyivDaySql('s."createdAt"'));

  const rows = await prisma.$queryRaw<(Omit<TripDayFacts, "day"> & { day: Date })[]>`
    WITH sh AS (
      SELECT s."userId", ${shiftDay} AS day,
        COUNT(*)::int                                          AS shifts,
        SUM(s."distanceKm")::float                             AS "odometerKm",
        SUM(s."gpsDistanceKm") FILTER (WHERE s."distanceKm" IS NOT NULL)::float AS "gpsKm",
        COALESCE(SUM(s."gpsDistanceKm") FILTER (WHERE s."distanceKm" IS NULL), 0)::float AS "gpsOnlyKm",
        COALESCE(SUM(s."personalKm"), 0)::float                AS "personalKm",
        COUNT(*) FILTER (WHERE s."odometerSuspicious")::int    AS suspicious,
        COUNT(*) FILTER (WHERE s."closedAutomatically")::int   AS "autoClosed"
      FROM "Shift" s
      WHERE s."startedAt" >= ${from} AND s."startedAt" <= ${to}
        ${userCondition}
      GROUP BY 1, 2
    ),
    vis AS (
      SELECT v."userId", ${visitDay} AS day,
        COUNT(*) FILTER (WHERE v.status = 'DONE')::int         AS "visitsDone",
        COUNT(*) FILTER (WHERE v.status = 'MISSED')::int       AS "visitsMissed",
        COALESCE(SUM(v."collectedAmount"), 0)::float           AS collected
      FROM "Visit" v
      WHERE v."userId" IN (SELECT "userId" FROM sh)
        -- Запас у добу з обох боків: Visit.day — київська дата, збережена як
        -- мітка, а межі періоду — UTC-моменти. Точний день відбирає JOIN нижче.
        AND v.day >= ${from}::timestamp - interval '1 day'
        AND v.day <= ${to}::timestamp + interval '1 day'
      GROUP BY 1, 2
    ),
    sales AS (
      SELECT s."salesRepId" AS "userId", ${docDay} AS day,
        SUM(s."totalAmount")::float                                            AS "salesAmount",
        COUNT(*) FILTER (WHERE ${SALES_ONLY})::int                             AS "salesDocs",
        COUNT(DISTINCT s."counterpartyId") FILTER (WHERE ${SALES_ONLY})::int   AS "salesClients",
        COALESCE(SUM(s."totalAmount" - c.cost) FILTER (WHERE c.cost IS NOT NULL), 0)::float AS margin,
        COALESCE(SUM(s."totalAmount") FILTER (WHERE c.cost IS NOT NULL), 0)::float          AS "costedAmount"
      FROM "SalesDocument" s
      LEFT JOIN LATERAL (
        SELECT SUM(i."purchasePrice" * i.quantity) AS cost
        FROM "SalesDocumentItem" i
        WHERE i."salesDocumentId" = s.id AND i."purchasePrice" > 0
      ) c ON TRUE
      WHERE ${SOURCE_FILTER}
        AND s."salesRepId" IN (SELECT "userId" FROM sh)
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      GROUP BY 1, 2
    )
    SELECT sh.*,
      COALESCE(vis."visitsDone", 0)      AS "visitsDone",
      COALESCE(vis."visitsMissed", 0)    AS "visitsMissed",
      COALESCE(vis.collected, 0)         AS collected,
      COALESCE(sales."salesAmount", 0)   AS "salesAmount",
      COALESCE(sales."salesDocs", 0)     AS "salesDocs",
      COALESCE(sales."salesClients", 0)  AS "salesClients",
      COALESCE(sales.margin, 0)          AS margin,
      COALESCE(sales."costedAmount", 0)  AS "costedAmount"
    FROM sh
    LEFT JOIN vis   ON vis."userId" = sh."userId"   AND vis.day = sh.day
    LEFT JOIN sales ON sales."userId" = sh."userId" AND sales.day = sh.day
    ORDER BY sh.day DESC, sh."userId"
  `;

  return rows.map((r) => ({ ...r, day: r.day.toISOString().slice(0, 10) }));
}
