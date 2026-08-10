/**
 * Який маршрут у торгового на конкретний день.
 *
 * Два види призначень: разове на дату і постійне на день тижня. Дата має
 * пріоритет — так разова заміна («сьогодні їде в Броди замість Радехова»)
 * не вимагає ламати постійний розклад.
 */

import { prisma } from "@/lib/prisma";
import { kyivDayStart, KYIV_TZ } from "@/lib/date/kyiv";

/** День тижня 1..7 (1 = понеділок) за київським часом. */
export function kyivWeekday(day: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, weekday: "short" }).format(
    // Полудень, а не опівніч: захищає від зсуву дня на межі переходу на літній час.
    new Date(kyivDayStart(day).getTime() + 12 * 3600_000)
  );
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return order.indexOf(name) + 1;
}

export type ResolvedRoute = {
  templateId: string;
  name: string;
  color: string | null;
  totalDistanceKm: number | null;
  routeGeometry: unknown;
  stops: Array<{ settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
  /** Звідки взявся маршрут: разове призначення чи постійний розклад */
  source: "DATE" | "WEEKDAY";
};

/** Маршрут торгового на день (YYYY-MM-DD за Києвом) або null. */
export async function resolveRouteForDay(repId: string, day: string): Promise<ResolvedRoute | null> {
  const date = kyivDayStart(day);
  const weekday = kyivWeekday(day);

  const assignments = await prisma.routeAssignment.findMany({
    where: {
      repId,
      OR: [{ date }, { weekday }],
    },
    include: { template: { include: { stops: { orderBy: { seq: "asc" } } } } },
  });

  if (assignments.length === 0) return null;

  const picked = assignments.find((a) => a.date !== null) ?? assignments[0];
  const t = picked.template;

  return {
    templateId: t.id,
    name: t.name,
    color: t.color,
    totalDistanceKm: t.totalDistanceKm,
    routeGeometry: t.routeGeometry,
    stops: t.stops.map((s) => ({
      settlement: s.settlement,
      displayName: s.displayName,
      lat: s.lat,
      lng: s.lng,
      seq: s.seq,
    })),
    source: picked.date !== null ? "DATE" : "WEEKDAY",
  };
}
