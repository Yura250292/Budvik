/**
 * Де маршрут стоїть у своєму шляху: точки → порядок → водій → посилання.
 *
 * Логіст працює з десятком карток одночасно, і головне питання на кожній —
 * «що тут лишилося зробити». Досі відповідь треба було збирати очима: є
 * бейдж статусу, десь нижче кнопка передачі, ще нижче посилання. Тепер стан
 * виводиться з даних однією функцією, і та сама функція дає ОДНУ дію, яку
 * картка показує жовтою кнопкою.
 *
 * Чисто виводиться з полів, які вже є (жодних нових прапорців у базі, крім
 * linkSentAt):
 *   1. Точки      — stops.length ≥ 1
 *   2. Порядок    — routeGeometry != null; це пише лише /api/routes/apply-order,
 *                   тобто «порядок справді прокладено», а не «десь є км».
 *   3. Передати   — статус ASSIGNED і далі: до передачі водій маршруту не бачить.
 *   4. Надіслати  — linkSentAt != null; якщо після надсилання маршрут правили,
 *                   крок знову стає поточним (linkStale).
 *
 * Крок 2 можна пропустити свідомо: маршрут із трьох сусідніх магазинів логіст
 * передає як є. Тому «пропущено» — окремий стан, а не діра в смузі.
 */

import { coordsOf, type MessageStop } from "@/lib/routes/driver-message";

export type StepState = "done" | "current" | "pending" | "skipped";
export type StepNumber = 1 | 2 | 3 | 4;

/** Що саме пропонує зробити жовта кнопка картки. */
export type RouteCta = "ADD_STOPS" | "ORDER" | "ASSIGN" | "SEND" | "RESEND" | null;

/** Чому поточний крок неможливо виконати просто зараз. */
export type StepBlocker = "NO_DRIVER" | "NO_COORDS" | null;

export type RouteProgress = {
  steps: Record<StepNumber, StepState>;
  current: StepNumber | null;
  cta: RouteCta;
  blocker: StepBlocker;
  stopsTotal: number;
  withCoords: number;
  /** Маршрут закритий (завершений або скасований): смуга не показується. */
  closed: boolean;
};

export const STEP_LABELS: Record<StepNumber, string> = {
  1: "Точки",
  2: "Порядок",
  3: "Передати",
  4: "Надіслати",
};

/** Статуси, у яких водій маршрут уже бачить. */
const HANDED = ["ASSIGNED", "IN_PROGRESS", "COMPLETED"];

export function routeProgress(route: {
  status: string;
  driverId: string | null;
  stops: MessageStop[];
  routeGeometry?: unknown | null;
  linkSentAt?: string | Date | null;
  /** Маршрут правили після того, як посилання пішло водієві */
  linkStale?: boolean;
}): RouteProgress {
  const stopsTotal = route.stops.length;
  const withCoords = route.stops.filter((s) => coordsOf(s)).length;
  const handed = HANDED.includes(route.status);
  const closed = route.status === "COMPLETED" || route.status === "CANCELLED";

  const hasStops = stopsTotal >= 1;
  const ordered = route.routeGeometry != null;
  const sent = route.linkSentAt != null;
  // Правили після надсилання — водій має застарілий порядок, крок відкривається знову.
  const resend = sent && !!route.linkStale;

  const steps: Record<StepNumber, StepState> = {
    1: hasStops ? "done" : "pending",
    // Передали без прокладання — крок не «не зроблений», а свідомо пропущений.
    2: ordered ? "done" : handed ? "skipped" : "pending",
    3: handed ? "done" : "pending",
    4: sent && !resend ? "done" : "pending",
  };

  if (closed) {
    return { steps, current: null, cta: null, blocker: null, stopsTotal, withCoords, closed };
  }

  // Поточний — перший невиконаний; «пропущено» не повертає логіста назад.
  const current: StepNumber | null =
    steps[1] === "pending" ? 1 : steps[2] === "pending" ? 2 : steps[3] === "pending" ? 3 : steps[4] === "pending" ? 4 : null;

  if (current !== null) steps[current] = "current";

  let cta: RouteCta = null;
  let blocker: StepBlocker = null;

  if (current === 1) cta = "ADD_STOPS";
  else if (current === 2) {
    // Оптимізатор рахує день водія, тож без водія рахувати нічого; менше двох
    // координат — OSRM нема через що вести дорогу.
    blocker = !route.driverId ? "NO_DRIVER" : withCoords < 2 ? "NO_COORDS" : null;
    cta = blocker ? null : "ORDER";
  } else if (current === 3) {
    blocker = !route.driverId ? "NO_DRIVER" : null;
    cta = blocker ? null : "ASSIGN";
  } else if (current === 4) {
    // Для надсилання досить однієї координати: стартом Google бере місце
    // водія, тож «я тут → клієнт» — уже маршрут. Оптимізатору (крок 2) двох
    // точок і далі мало не буде: там дорогу рахує OSRM між нашими точками.
    blocker = withCoords < 1 ? "NO_COORDS" : null;
    cta = blocker ? null : resend ? "RESEND" : "SEND";
  }

  return { steps, current, cta, blocker, stopsTotal, withCoords, closed };
}
