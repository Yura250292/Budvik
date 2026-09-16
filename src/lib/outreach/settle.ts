/**
 * Чим закінчилась пропозиція — воркер закриває ClientOutreach сам.
 *
 * Торговий не відмічатиме «клієнт замовив»: замовлення він робить в іншій
 * програмі, а до нашого застосунку повертається двічі на день. Тож результат
 * бачимо там, де він справді видний, — у проведеній реалізації з 1С:
 *
 *   PENDING + реалізація клієнта у вікні  → ORDERED (накладна й сума)
 *   PENDING старша за NO_ANSWER_AFTER_DAYS → NO_ANSWER
 *
 * Ручну відмітку (outcomeBy = 'REP') і будь-який не-PENDING стан воркер не
 * чіпає ніколи: умова outcome = 'PENDING' стоїть у самому UPDATE, тож навіть
 * відмітка, зроблена між читанням і записом, переможе.
 *
 * Які пропозиції. Усі, незалежно від purpose. Нагадування про борг (DEBT),
 * після якого клієнт узяв товар, — теж результат: розмова відбулася і
 * закінчилась відвантаженням. Оплата боргу — не реалізація, тому «закрив
 * борг» пропозицію не закриває; про це чесно скаже NO_ANSWER, а відсоток
 * конверсії в адмінці рахується лише по MARKETING (admin-stats.ts).
 *
 * У 1С не пишеться нічого — лише наша таблиця.
 *
 * Модуль без next/*: воркер (worker/index.ts, tickOutreach).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivOffsetMs } from "@/lib/date/kyiv";
import { uah } from "@/lib/rep-feed/format";
import { labelOf, NO_ANSWER_AFTER_DAYS, ORDERED_WINDOW_DAYS, OUTREACH_KINDS } from "./types";

const DAY_MS = 86_400_000;

export type SettleResult = {
  ordered: number;
  noAnswer: number;
  /** Людський журнал: по рядку на закриту (або, у dry, ту, що закрилась би) пропозицію. */
  lines: string[];
};

type OrderedRow = {
  id: string;
  kind: string;
  sentAt: Date;
  cpName: string | null;
  repName: string | null;
  docId: string;
  docNumber: string;
  amount: number;
  docAt: Date;
};

/**
 * Стінний київський час, записаний як UTC, — саме так лежать дати документів
 * 1С (агент віддає час без зсуву, сервер читає його як UTC; див. заголовок
 * src/lib/track/orders-today.ts і docDayFloor у rep-feed/format.ts).
 */
export function kyivWallClock(at: Date): Date {
  return new Date(at.getTime() + kyivOffsetMs(at));
}

/**
 * Параметр часу для сирого SQL без поясу: «2026-09-14T10:00:00.000» ::timestamp.
 * Так значення не залежить від TimeZone сесії бази.
 */
function ts(d: Date): string {
  return d.toISOString().replace("Z", "");
}

/**
 * Перша проведена реалізація клієнта у вікні кожної відкритої пропозиції.
 *
 * Межі вікна — у стінному київському часі документа:
 *   від 00:00 київського дня відправки
 *   до кінця (день відправки + ORDERED_WINDOW_DAYS).
 *
 * Чому від початку дня, а не від хвилини відправки. Дата реалізації в 1С —
 * не мить, коли клієнт вирішив купити, а те, що поставив офіс, набираючи
 * накладну: часто це дата замовлення зранку або ранній час дня відвантаження.
 * Торговий пише о 10:30, клієнт телефонує в офіс об 11:00, а накладна лягає
 * з часом 09:12 — з точним порівнянням така покупка випала б. Ціна рішення —
 * покупка того самого дня ДО повідомлення теж зарахується; базова оцінка
 * (baseline.ts) рахує вікно так само, по днях, тож перекіс однаковий з обох
 * боків порівняння.
 *
 * Київський день відправки рахує сама база: sentAt — справжній UTC, і
 * `AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv'` дає стінний час із
 * урахуванням літнього часу на дату кожного рядка.
 *
 * Нижньої межі за sentAt немає свідомо. Відкриті пропозиції самі себе
 * обмежують: усе старше NO_ANSWER_AFTER_DAYS цей самий прохід закриває як
 * NO_ANSWER, тож PENDING ніколи не буває старшим за три тижні. Зате
 * реалізація, яку офіс провів через тиждень після її дати, ще встигає
 * закрити пропозицію як ORDERED, а не «без відповіді». LATERAL + LIMIT 1 іде
 * індексом (counterpartyId, docType, createdAt) — один запит на всі рядки.
 */
function orderedMatches(now: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT
      o.id,
      o.kind,
      o."sentAt",
      c.name AS "cpName",
      u.name AS "repName",
      m.id AS "docId",
      m.number AS "docNumber",
      m."totalAmount"::float AS amount,
      m."createdAt" AS "docAt"
    FROM "ClientOutreach" o
    JOIN "Counterparty" c ON c.id = o."counterpartyId"
    LEFT JOIN "User" u ON u.id = o."repId"
    CROSS JOIN LATERAL (
      SELECT d.id, d.number, d."totalAmount", d."createdAt"
      FROM "SalesDocument" d
      WHERE d."counterpartyId" = o."counterpartyId"
        AND d."docType" = 'REALIZATION'
        AND d.status = 'CONFIRMED'
        AND d."externalId" IS NOT NULL
        AND d."createdAt" >= date_trunc('day', (o."sentAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Kyiv')
        AND d."createdAt" < date_trunc('day', (o."sentAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Kyiv')
                            + make_interval(days => ${ORDERED_WINDOW_DAYS + 1}::int)
        AND d."createdAt" <= ${ts(kyivWallClock(now))}::timestamp
      ORDER BY d."createdAt", d.id
      LIMIT 1
    ) m
    WHERE o.outcome = 'PENDING'
      AND o."sentAt" <= ${ts(now)}::timestamp
  `;
}

function orderedLine(r: OrderedRow): string {
  return (
    `ORDERED    ${r.cpName ?? "?"} · ${r.repName ?? "без торгового"} · ${labelOf(OUTREACH_KINDS, r.kind)}` +
    ` · написали ${kyivDate(r.sentAt)} → №${r.docNumber} від ${r.docAt.toISOString().slice(0, 10)}` +
    ` на ${uah(r.amount)} ₴`
  );
}

/**
 * Один прохід. `dry` нічого не пише, але показує рівно те, що закрив би
 * справжній прохід у мить `now` (для скрипта scripts/outreach-settle-dry.mts).
 */
export async function settleOutreachOutcomes(
  opts: { now?: Date; dry?: boolean } = {}
): Promise<SettleResult> {
  const now = opts.now ?? new Date();
  const dry = opts.dry === true;
  const lines: string[] = [];

  // ---- ORDERED ----
  let ordered: OrderedRow[];
  if (dry) {
    ordered = await prisma.$queryRaw<OrderedRow[]>`${orderedMatches(now)}`;
  } else {
    ordered = await prisma.$queryRaw<OrderedRow[]>`
      WITH m AS (${orderedMatches(now)})
      UPDATE "ClientOutreach" o
      SET outcome = 'ORDERED',
          "outcomeBy" = 'WORKER',
          "outcomeDocId" = m."docId",
          "outcomeAmount" = m.amount,
          "outcomeAt" = ${ts(now)}::timestamp,
          "updatedAt" = ${ts(now)}::timestamp
      FROM m
      WHERE o.id = m.id AND o.outcome = 'PENDING'
      RETURNING o.id, o.kind, o."sentAt", m."cpName", m."repName", m."docId", m."docNumber", m.amount, m."docAt"
    `;
  }
  for (const r of ordered) lines.push(orderedLine(r));

  // ---- NO_ANSWER ----
  // Після ORDERED: те, що щойно закрилось накладною, «без відповіді» вже не стане.
  const orderedIds = new Set(ordered.map((r) => r.id));
  const stale = (
    await prisma.clientOutreach.findMany({
      where: {
        outcome: "PENDING",
        sentAt: { lt: new Date(now.getTime() - NO_ANSWER_AFTER_DAYS * DAY_MS) },
      },
      select: {
        id: true,
        kind: true,
        sentAt: true,
        counterparty: { select: { name: true } },
        rep: { select: { name: true } },
      },
      orderBy: { sentAt: "asc" },
    })
  ).filter((r) => !orderedIds.has(r.id));

  let noAnswer = stale.length;
  if (!dry && stale.length > 0) {
    const res = await prisma.clientOutreach.updateMany({
      where: { id: { in: stale.map((r) => r.id) }, outcome: "PENDING" },
      data: { outcome: "NO_ANSWER", outcomeBy: "WORKER", outcomeAt: now },
    });
    noAnswer = res.count;
  }
  for (const r of stale) {
    const days = Math.floor((now.getTime() - r.sentAt.getTime()) / DAY_MS);
    lines.push(
      `NO_ANSWER  ${r.counterparty.name} · ${r.rep?.name ?? "без торгового"} · ${labelOf(OUTREACH_KINDS, r.kind)}` +
        ` · написали ${kyivDate(r.sentAt)} (${days} дн тому), реалізації у вікні немає`
    );
  }

  return { ordered: ordered.length, noAnswer, lines };
}

/**
 * Таблиці ще немає — міграцію не накочено (білд Vercel і воркер її не
 * накочують, див. CLAUDE.md). Воркер і скрипт кажуть про це одним рядком,
 * а не стеком раз на чверть години.
 */
export function isOutreachTableMissing(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : String(e);
  if (code === "P2021" && message.includes("ClientOutreach")) return true;
  return message.includes("ClientOutreach") && /does not exist|42P01/.test(message);
}
