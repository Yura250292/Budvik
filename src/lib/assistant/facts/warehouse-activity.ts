/**
 * Склад: хто скільки зібрав — за відмітками збірки в застосунку.
 *
 * Складовщик не продає й нікуди не їде, тож жодна з готових аналітик
 * (оборот, дебіторка, зарплата водія) про нього нічого не каже. Єдиний
 * слід його роботи в базі — три речі: відмітки зібраних рядків
 * (`PickMark`), фото накладних на розпізнавання (`WarehouseReport`) і
 * зміни (`WarehouseShift`). Тут вони зводяться в один рядок на людину.
 *
 * ГОЛОВНЕ ПРАВИЛО — НУЛЬ НЕ ВИДАЄТЬСЯ ЗА ФАКТ. Відмітки збірки в проді
 * порожні (перевірено 10.09.2026: 0 рядків у `PickMark`), і «Юра зібрав
 * 0 накладних» читалося б як звинувачення, хоча означає лише те, що
 * застосунок цю подію ще не записує. Тому коли відміток за період немає
 * взагалі, у примітці про це сказано прямо, а таблиця показує лише те,
 * що справді є: зміни й фото накладних.
 *
 * Дві каверзи даних, про які має знати відповідь:
 * • `PickMark.userId` — хто відмітив рядок ОСТАННІМ. Накладну могли
 *   збирати двоє, і рядки дістануться тому, хто торкнувся їх пізніше.
 * • Час на накладну — різниця між першою й останньою відміткою в ній.
 *   На одному рядку різниці немає, а вкладка, забута на весь день, дає
 *   вісім годин «збірки». Тому хвилини рахуються лише при двох і більше
 *   рядках і не довше за MAX_DOC_MINUTES.
 *
 * Ростер береться з довідника людей, а не з відміток: складовщик без
 * жодної відмітки має бути в таблиці з нулями — інакше його просто не
 * видно, а «не видно» гірше за «нуль із поясненням».
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/analytics/period";
import { listStaff } from "@/lib/assistant/facts/staff";
import { kyivDate, kyivTime } from "@/lib/date/kyiv";
import { uah } from "@/lib/assistant/format";

/** Довше за чотири години на одну накладну — це не збірка, а забута вкладка. */
const MAX_DOC_MINUTES = 240;

/** Скільки документів показувати в розкладці по людині. */
const DOCS_LIMIT = 20;

export type WarehouseWorker = {
  user_id: string;
  ім_я: string;
  документів: number;
  рядків: number;
  штук: number;
  днів_з_відмітками: number;
  /** Документів на день, у який були відмітки; null — відміток не було. */
  документів_на_день: number | null;
  /** Середні хвилини на накладну (лише накладні з ≥ 2 рядками); null — нема з чого. */
  хв_на_документ: number | null;
  /** «08:40» — о котрій у середньому зʼявляється перша відмітка дня. */
  перша_відмітка_в_середньому: string | null;
  остання_відмітка_в_середньому: string | null;
  звітів_фото: { прочитано: number; читається: number; не_вийшло: number };
  змін: number;
  /** Години в закритих змінах. Відкрита зараз — окремо, бо ще триває. */
  годин: number;
  зараз_на_зміні: { відкрита: string; годин: number } | null;
};

export type WarehouseDoc = {
  документ_id: string;
  номер: string;
  клієнт_id: string | null;
  клієнт: string | null;
  рядків_відмічено: number;
  позицій_у_накладній: number;
  почав: string;
  закінчив: string;
  хвилин: number | null;
  сума: number;
};

export type WarehouseMedians = {
  документів_на_день: number | null;
  хв_на_документ: number | null;
  рядків: number | null;
};

export type WarehouseActivity = {
  працівники: WarehouseWorker[];
  /** null — жодної людини з відмітками, медіани рахувати нема з чого. */
  медіани: WarehouseMedians | null;
  /** Розкладка по накладних — лише коли питали про одну людину. */
  документи?: WarehouseDoc[];
  примітка: string;
};

/** Один рядок на пару «людина × накладна» — зерно, з якого росте все інше. */
type MarkRow = {
  userId: string;
  salesDocumentId: string;
  marked: number;
  pieces: number;
  startedAt: Date;
  finishedAt: Date;
  number: string;
  counterpartyId: string | null;
  client: string | null;
  positions: number;
  total: number;
};

type ReportStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

/** Хвилина київської доби: «08:40» → 520. */
function minuteOfDay(at: Date): number {
  const [h, m] = kyivTime(at).split(":").map(Number);
  return h * 60 + m;
}

/** 520 → «08:40». */
function hhmm(minutes: number): string {
  const total = Math.round(minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** «2026-09-10 14:32» — момент так, як його прочитає керівник. */
function stamp(at: Date): string {
  return `${kyivDate(at)} ${kyivTime(at)}`;
}

function median(values: number[]): number | null {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (list.length === 0) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 === 1 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Хвилини збірки накладної або null, якщо їх не можна довіряти. */
function docMinutes(row: MarkRow): number | null {
  if (row.marked < 2) return null;
  const minutes = (row.finishedAt.getTime() - row.startedAt.getTime()) / 60_000;
  if (minutes > MAX_DOC_MINUTES) return null;
  return Math.round(minutes);
}

/**
 * Активність складу за період: по всіх складовщиках або по одному.
 *
 * `workerId` звужує вибірку й додає розкладку по накладних. Ростер при
 * цьому все одно береться з довідника: людина без відміток має
 * зʼявитися з нулями, а не зникнути.
 */
export async function warehouseActivity(
  period: Period,
  workerId: string | null
): Promise<WarehouseActivity> {
  const userCondition = workerId ? Prisma.sql`AND m."userId" = ${workerId}` : Prisma.empty;
  const now = new Date();

  const [marks, reports, shifts, openShifts, roster] = await Promise.all([
    prisma.$queryRaw<MarkRow[]>`
      SELECT
        m."userId"                 AS "userId",
        m."salesDocumentId"        AS "salesDocumentId",
        COUNT(*)::int              AS marked,
        COALESCE(SUM(m.quantity), 0)::float AS pieces,
        MIN(m."updatedAt")         AS "startedAt",
        MAX(m."updatedAt")         AS "finishedAt",
        d.number                   AS number,
        d."counterpartyId"         AS "counterpartyId",
        c.name                     AS client,
        d."totalAmount"::float     AS total,
        (
          SELECT COUNT(DISTINCT i."productId")
          FROM "SalesDocumentItem" i
          WHERE i."salesDocumentId" = d.id
        )::int                     AS positions
      FROM "PickMark" m
      JOIN "SalesDocument" d ON d.id = m."salesDocumentId"
      LEFT JOIN "Counterparty" c ON c.id = d."counterpartyId"
      WHERE m.quantity > 0
        AND m."updatedAt" >= ${period.from} AND m."updatedAt" <= ${period.to}
        ${userCondition}
      GROUP BY m."userId", m."salesDocumentId", d.id, c.name
      ORDER BY MAX(m."updatedAt") DESC
    `,
    prisma.warehouseReport.groupBy({
      by: ["userId", "status"],
      where: {
        createdAt: { gte: period.from, lte: period.to },
        ...(workerId ? { userId: workerId } : {}),
      },
      _count: { _all: true },
    }),
    prisma.warehouseShift.findMany({
      where: {
        openedAt: { gte: period.from, lte: period.to },
        ...(workerId ? { userId: workerId } : {}),
      },
      select: { userId: true, status: true, openedAt: true, closedAt: true, durationMinutes: true },
    }),
    /**
     * Відкрита зараз — без прив'язки до періоду: зміна, забута тиждень
     * тому, для питання «хто зараз на складі» важить рівно стільки ж.
     */
    prisma.warehouseShift.findMany({
      where: { status: "OPEN", ...(workerId ? { userId: workerId } : {}) },
      select: { userId: true, openedAt: true },
      orderBy: { openedAt: "asc" },
    }),
    listStaff(["WAREHOUSE"]),
  ]);

  /* ── Відмітки → зведення по людині ─────────────────────────────────── */

  type Agg = {
    docs: number;
    lines: number;
    pieces: number;
    days: Set<string>;
    minutes: number[];
    firstByDay: Map<string, number>;
    lastByDay: Map<string, number>;
  };
  const byUser = new Map<string, Agg>();

  for (const row of marks) {
    const acc =
      byUser.get(row.userId) ??
      {
        docs: 0,
        lines: 0,
        pieces: 0,
        days: new Set<string>(),
        minutes: [],
        firstByDay: new Map<string, number>(),
        lastByDay: new Map<string, number>(),
      };
    acc.docs += 1;
    acc.lines += row.marked;
    acc.pieces += row.pieces;

    const minutes = docMinutes(row);
    if (minutes != null) acc.minutes.push(minutes);

    // Перша й остання відмітка дня — по дню кожної межі накладної окремо:
    // накладна, яку почали ввечері й дозбирали зранку, належить обом дням.
    for (const [at, map, pick] of [
      [row.startedAt, acc.firstByDay, Math.min],
      [row.finishedAt, acc.lastByDay, Math.max],
    ] as const) {
      const day = kyivDate(at);
      acc.days.add(day);
      const prev = map.get(day);
      const minute = minuteOfDay(at);
      map.set(day, prev == null ? minute : pick(prev, minute));
    }

    byUser.set(row.userId, acc);
  }

  /* ── Фото накладних і зміни ───────────────────────────────────────── */

  const reportsByUser = new Map<string, WarehouseWorker["звітів_фото"]>();
  for (const r of reports) {
    const acc = reportsByUser.get(r.userId) ?? { прочитано: 0, читається: 0, не_вийшло: 0 };
    const status = r.status as ReportStatus;
    if (status === "DONE") acc.прочитано += r._count._all;
    else if (status === "FAILED") acc.не_вийшло += r._count._all;
    else acc.читається += r._count._all;
    reportsByUser.set(r.userId, acc);
  }

  const shiftsByUser = new Map<string, { count: number; minutes: number }>();
  for (const s of shifts) {
    const acc = shiftsByUser.get(s.userId) ?? { count: 0, minutes: 0 };
    acc.count += 1;
    if (s.status === "CLOSED") {
      const fallback = s.closedAt ? (s.closedAt.getTime() - s.openedAt.getTime()) / 60_000 : 0;
      acc.minutes += s.durationMinutes ?? Math.max(0, fallback);
    }
    shiftsByUser.set(s.userId, acc);
  }

  const openByUser = new Map(openShifts.map((s) => [s.userId, s.openedAt]));

  /* ── Ростер: довідник + усі, хто лишив слід, але з довідника випав ─── */

  const names = new Map(roster.map((s) => [s.id, s.name]));
  const seen = new Set<string>([
    ...byUser.keys(),
    ...reportsByUser.keys(),
    ...shiftsByUser.keys(),
    ...openByUser.keys(),
  ]);
  const unknown = [...seen].filter((id) => !names.has(id));
  if (unknown.length > 0) {
    const extra = await prisma.user.findMany({
      where: { id: { in: unknown } },
      select: { id: true, name: true },
    });
    for (const u of extra) names.set(u.id, u.name ?? "—");
  }

  const ids = workerId
    ? [workerId]
    : [...new Set<string>([...roster.map((s) => s.id), ...seen])];

  const workers: WarehouseWorker[] = ids.map((id) => {
    const a = byUser.get(id);
    const sh = shiftsByUser.get(id) ?? { count: 0, minutes: 0 };
    const openedAt = openByUser.get(id) ?? null;
    const avg = (map: Map<string, number> | undefined) =>
      map && map.size > 0 ? hhmm([...map.values()].reduce((s, v) => s + v, 0) / map.size) : null;

    return {
      user_id: id,
      ім_я: names.get(id) ?? "—",
      документів: a?.docs ?? 0,
      рядків: a?.lines ?? 0,
      штук: Math.round(a?.pieces ?? 0),
      днів_з_відмітками: a?.days.size ?? 0,
      документів_на_день: a && a.days.size > 0 ? round1(a.docs / a.days.size) : null,
      хв_на_документ:
        a && a.minutes.length > 0
          ? Math.round(a.minutes.reduce((s, v) => s + v, 0) / a.minutes.length)
          : null,
      перша_відмітка_в_середньому: avg(a?.firstByDay),
      остання_відмітка_в_середньому: avg(a?.lastByDay),
      звітів_фото: reportsByUser.get(id) ?? { прочитано: 0, читається: 0, не_вийшло: 0 },
      змін: sh.count,
      годин: round1(sh.minutes / 60),
      зараз_на_зміні: openedAt
        ? {
            відкрита: stamp(openedAt),
            годин: round1((now.getTime() - openedAt.getTime()) / 3_600_000),
          }
        : null,
    };
  });

  workers.sort((a, b) => b.документів - a.документів || b.змін - a.змін || a.ім_я.localeCompare(b.ім_я, "uk"));

  /* ── Медіани — лише серед тих, хто відмічав ───────────────────────── */

  const active = workers.filter((w) => w.документів > 0);
  const medians: WarehouseMedians | null =
    active.length > 0
      ? {
          документів_на_день: median(
            active.map((w) => w.документів_на_день).filter((v): v is number => v != null)
          ),
          хв_на_документ: median(
            active.map((w) => w.хв_на_документ).filter((v): v is number => v != null)
          ),
          рядків: median(active.map((w) => w.рядків)),
        }
      : null;

  /* ── Накладні однієї людини ───────────────────────────────────────── */

  const docs: WarehouseDoc[] | undefined = workerId
    ? marks.slice(0, DOCS_LIMIT).map((row) => ({
        документ_id: row.salesDocumentId,
        номер: row.number,
        клієнт_id: row.counterpartyId,
        клієнт: row.client,
        рядків_відмічено: row.marked,
        позицій_у_накладній: row.positions,
        почав: stamp(row.startedAt),
        закінчив: stamp(row.finishedAt),
        хвилин: docMinutes(row),
        сума: uah(row.total),
      }))
    : undefined;

  const noMarks = marks.length === 0;
  const примітка = [
    noMarks
      ? "Відміток збірки в застосунку за період немає — тоді видно лише зміни й фото накладних."
      : null,
    "Складовщик у відмітці — той, хто відмітив рядок останнім; хвилини на накладну рахуються лише при двох і більше рядках.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    працівники: workers,
    медіани: medians,
    ...(docs ? { документи: docs } : {}),
    примітка,
  };
}
