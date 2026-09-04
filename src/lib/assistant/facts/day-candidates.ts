/**
 * Кого варто відвідати в конкретний день — готовий список кандидатів.
 *
 * Модель тут нічого не вигадує: вона отримує список із підставами й лише
 * впорядковує його та пояснює словами. Так само, як у чеклісті керівника
 * (company/rep-actions.ts) — і з тієї ж причини: клієнта, якого немає в
 * списку, вигадати неможливо, бо його немає у вхідних даних.
 *
 * Дві сторони одного дня. Звичка каже, де торговий буває в цей день
 * тижня, — це географія, і ламати її заради одного боржника означає
 * втратити півдня на дорогу. Термінові дії кажуть, з ким треба
 * поговорити, — і якщо такий клієнт лежить на звичному маршруті, він
 * має бути першим.
 */

import { repActionCandidates, ACTION_LABELS } from "@/lib/analytics/company/rep-actions";
import { routeHabits, WEEKDAY_GENITIVE, WEEKDAY_NAMES } from "@/lib/assistant/facts/route-habits";
import { resolveRouteForDay, kyivWeekday } from "@/lib/routes/resolve";
import { payerVerdicts, verdictLabel } from "@/lib/assistant/facts/discipline-cache";
import { prisma } from "@/lib/prisma";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";
import { days as roundDays, uah } from "@/lib/assistant/format";

/** Скільки термінових дій домішуємо до звички. */
const URGENT_LIMIT = 8;

export async function dayRouteCandidates(repId: string, day: string, limit = 12) {
  const weekday = kyivWeekday(day);

  // Дії дивимось за місяць: за коротший період портфель не встигає
  // показати, хто відстає від власного ритму.
  const fromDay = shiftDay(day, -29);
  const period = {
    fromDay,
    toDay: day,
    from: kyivDayStart(fromDay),
    to: kyivDayEnd(day),
    days: 30,
    clamped: false,
  };

  const [habits, route, actions, discipline] = await Promise.all([
    routeHabits(repId, 8),
    resolveRouteForDay(repId, day),
    repActionCandidates(repId, period),
    payerVerdicts(),
  ]);

  const habitDay = habits.byWeekday.find((d) => d.weekday === weekday);
  const habitual = new Map(habitDay?.clients.map((c) => [c.counterpartyId, c]) ?? []);
  const actionByClient = new Map(actions.map((a) => [a.counterpartyId, a]));

  const urgent = actions.slice(0, URGENT_LIMIT);
  const ids = new Set<string>([...habitual.keys(), ...urgent.map((a) => a.counterpartyId)]);

  const geo = await prisma.counterparty.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, address: true, phone: true, deliveryLat: true, deliveryLng: true },
  });
  const geoById = new Map(geo.map((g) => [g.id, g]));

  const rows = [...ids].map((id) => {
    const habit = habitual.get(id);
    const action = actionByClient.get(id);
    const info = geoById.get(id);

    const reasons: string[] = [];
    if (habit) {
      const parts: string[] = [];
      if (habit.orders) parts.push(`${habit.orders} замовлень`);
      if (habit.visits) parts.push(`${habit.visits} відміток візиту`);
      if (habit.stops) parts.push(`${habit.stops} зупинок треку`);
      reasons.push(
        `звичний для ${WEEKDAY_GENITIVE[weekday - 1]} за 8 тижнів: ${parts.join(", ") || "трапляється"}`
      );
    }
    if (action) reasons.push(`${ACTION_LABELS[action.kind]}: ${action.why}`);

    return {
      клієнт_id: id,
      назва: info?.name ?? action?.name ?? habit?.name ?? "—",
      адреса: info?.address ?? null,
      телефон: info?.phone ?? null,
      точка_на_карті: info?.deliveryLat != null && info?.deliveryLng != null,
      звичний_для_дня: Boolean(habit),
      дія: action ? ACTION_LABELS[action.kind] : null,
      підстави: reasons,
      борг: uah(action?.debt ?? 0),
      прострочено: uah(action?.overdue ?? 0),
      вердикт: verdictLabel(discipline.verdicts.get(id)),
      днів_з_останньої: action ? roundDays(action.daysSinceLast) : null,
      ритм_днів: action ? roundDays(action.avgIntervalDays) : null,
      /** Внутрішня вага для порядку — модель може її ігнорувати. */
      вага:
        (habit?.score ?? 0) +
        (action ? 6 : 0) +
        (action?.overdue ? Math.min(10, action.overdue / 5000) : 0),
    };
  });

  rows.sort((a, b) => b.вага - a.вага);
  const top = rows.slice(0, limit);

  return {
    день: day,
    день_тижня: WEEKDAY_NAMES[weekday - 1],
    маршрут_за_розкладом: route
      ? {
          назва: route.name,
          звідки: route.source === "DATE" ? "разове призначення на дату" : "постійний розклад",
          пункти: route.stops.map((s) => s.displayName ?? s.settlement),
        }
      : null,
    кандидати: top,
    // Підсумок рахуємо ТУТ, а не лишаємо моделі: додавання десяти чисел у
    // голові дає розбіжність на кілька тисяч, і торговий помічає її
    // першою — після чого не вірить усьому плану.
    разом: {
      точок: top.length,
      борг: uah(top.reduce((sum, r) => sum + r.борг, 0)),
      прострочено: uah(top.reduce((sum, r) => sum + r.прострочено, 0)),
      звичних_для_дня: top.filter((r) => r.звичний_для_дня).length,
    },
    примітка:
      "список зібраний із звички (замовлення, візити, зупинки треку за 8 тижнів) і термінових дій за 30 днів; порядок можна змінювати, але клієнтів поза списком брати нізвідки",
  };
}
