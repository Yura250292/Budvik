/**
 * «Лише живі люди» для звітів вебаналітики.
 *
 * Людина — сесія, у якій браузер надіслав подію human (див. human.ts). До
 * того як браузери почали її слати, доказу поведінки немає, тож старі дні
 * оцінюємо за країною: у серпні не-українських відвідувачів було 0–1 на
 * день, а хвиля ботів 01–13.09 була на 100% закордонна. Правило «дві події
 * в сесії» тут не годиться — одне відкриття картки товару вже дає дві, а
 * третина живих сесій мала лише одну.
 */

import { Prisma } from "@prisma/client";

/** З цього дня кожен живий браузер шле human; раніше — оцінка за країною. */
export const HUMAN_SIGNALS_SINCE_DAY = "2026-09-17";
export const HUMAN_SIGNALS_SINCE = new Date(`${HUMAN_SIGNALS_SINCE_DAY}T00:00:00+03:00`);

export type TrafficView = "people" | "all";

/** Типово — лише люди; view=all показує все, що дійшло до лічильника. */
export function parseView(params: URLSearchParams): TrafficView {
  return params.get("view") === "all" ? "all" : "people";
}

/**
 * Умова для WHERE: подія належить живій людині. Для view=all — порожня.
 *
 * Підзапит без меж дат навмисно: доказ «людина» приходить за кілька секунд
 * після першої сторінки й може впасти вже за межею періоду, а подій human
 * лише стільки, скільки живих сесій, — десятки на день.
 */
export function peopleOnly(view: TrafficView, alias?: string): Prisma.Sql {
  if (view === "all") return Prisma.empty;
  const col = (name: string) => Prisma.raw(alias ? `${alias}."${name}"` : `"${name}"`);
  return Prisma.sql`AND (
    ${col("sessionId")} IN (SELECT h."sessionId" FROM "SiteEvent" h WHERE h."type" = 'human')
    OR (${col("createdAt")} < ${HUMAN_SIGNALS_SINCE} AND ${col("country")} = 'UA')
  )`;
}
