/**
 * Стан і ритм ОДНОГО клієнта — без прив'язки до торгового.
 *
 * clientPortfolio() відповідає на те саме питання, але для всього портфеля
 * і лише по документах конкретного торгового. Помічнику потрібне інше:
 * картку клієнта відкривають і по чужому клієнту («мене питали про цей
 * магазин»), і документи там можуть бути оформлені на офіс. Тому тут
 * рахуємо по ВСІХ документах контрагента.
 *
 * Пороги не дублюються: класифікує та сама classifyClient() з clients.ts,
 * інакше «спить» у помічника й «спить» на карті колись розійшлися б.
 */

import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { classifyClient, avgIntervalDays, type ClientState } from "@/lib/analytics/clients";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";

const DAY_MS = 86_400_000;

/**
 * Вікно, у межах якого клієнт вважається «новим».
 *
 * 30 днів — те саме вікно, що стоїть за замовчуванням у кабінеті: клієнт,
 * позначений новим у помічнику, має бути новим і на карті, інакше торговий
 * отримає дві різні правди про одну людину.
 */
const NEW_WINDOW_DAYS = 30;

export type ClientStateFacts = {
  state: ClientState | null;
  firstDocAt: Date | null;
  lastDocAt: Date | null;
  daysSinceLast: number | null;
  /** Середній інтервал між ДНЯМИ з покупками — власний ритм клієнта. */
  avgIntervalDays: number;
  historyDocs: number;
  historyDays: number;
};

type Row = {
  firstDocAt: Date | null;
  lastDocAt: Date | null;
  historyDocs: number;
  historyDays: number;
};

export async function clientStateNow(counterpartyId: string): Promise<ClientStateFacts> {
  const [row] = await prisma.$queryRaw<Row[]>`
    SELECT
      MIN(s."createdAt") FILTER (WHERE s."docType" <> 'RETURN') AS "firstDocAt",
      MAX(s."createdAt") FILTER (WHERE s."docType" <> 'RETURN') AS "lastDocAt",
      COUNT(*) FILTER (WHERE s."docType" <> 'RETURN')::int AS "historyDocs",
      COUNT(DISTINCT (s."createdAt" AT TIME ZONE 'Europe/Kyiv')::date)
        FILTER (WHERE s."docType" <> 'RETURN')::int AS "historyDays"
    FROM "SalesDocument" s
    WHERE ${SOURCE_FILTER} AND s."counterpartyId" = ${counterpartyId}
  `;

  if (!row?.firstDocAt || !row.lastDocAt) {
    return {
      state: null,
      firstDocAt: null,
      lastDocAt: null,
      daysSinceLast: null,
      avgIntervalDays: 0,
      historyDocs: 0,
      historyDays: 0,
    };
  }

  const today = kyivDate(new Date());
  const period = {
    fromDay: shiftDay(today, -(NEW_WINDOW_DAYS - 1)),
    toDay: today,
    from: kyivDayStart(shiftDay(today, -(NEW_WINDOW_DAYS - 1))),
    to: kyivDayEnd(today),
    days: NEW_WINDOW_DAYS,
    clamped: false,
  };

  const shaped = {
    firstDocAt: row.firstDocAt,
    lastDocAt: row.lastDocAt,
    historyDocs: row.historyDocs,
    historyDays: row.historyDays,
  };

  return {
    state: classifyClient(shaped, period),
    firstDocAt: row.firstDocAt,
    lastDocAt: row.lastDocAt,
    daysSinceLast: Math.max(0, Math.floor((Date.now() - row.lastDocAt.getTime()) / DAY_MS)),
    avgIntervalDays: avgIntervalDays(shaped),
    historyDocs: row.historyDocs,
    historyDays: row.historyDays,
  };
}

export const STATE_LABELS: Record<ClientState, string> = {
  NEW: "новий",
  ACTIVE: "активний",
  SLIPPING: "відстає від свого ритму",
  DORMANT: "спить (60+ днів)",
  LOST: "втрачений (90+ днів)",
};
