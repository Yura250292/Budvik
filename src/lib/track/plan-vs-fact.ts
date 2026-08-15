/**
 * План проти факту: трек дня, накладений на призначений маршрут.
 *
 * Ланка, якої бракувало. Математика відхилень (коридор, епізоди) давно
 * написана в lib/sales/deviation.ts, поля для неї є в базі, а API й UI
 * їх показують — але ніхто ніколи не рахував і не записував. Тому
 * «Поза маршрутом» завжди показувало 0, а червоних кіл на карті не було
 * жодного разу.
 *
 * Рахуємо на льоту, а не при закритті поїздки. Причини дві. Трек дня —
 * це кілька сотень точок, і аналіз коштує мілісекунди. А головне: план
 * можна перепризначити заднім числом, коридор — підкрутити, і збережений
 * колись результат став би брехнею, яку ніхто не помітить.
 *
 * Модуль свідомо нічого не знає про джерело точок: TrackPoint з планшета
 * і SalesTrackPoint з бота приходять сюди в тому самому вигляді.
 */

import {
  analyzeDeviation,
  routeNodesFromTemplate,
  CORRIDOR_M,
  type DeviationResult,
  type RouteNode,
} from "@/lib/sales/deviation";
import { resolveRouteForDay, type ResolvedRoute } from "@/lib/routes/resolve";

/** Точка треку в тому мінімумі, який потрібен для аналізу. */
export type AnalyzedPoint = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: Date;
};

/**
 * Наскільки ширшим стає коридор, коли плану-геометрії немає і лінія
 * зведена до прямих між пунктами.
 *
 * Пряма ріже кути: між двома селами дорога петляє по горбах, а хорда
 * йде навпростець, і торговий, що сумлінно їде трасою, опиняється за
 * кілометри від «маршруту». Подвоєння — та мінімальна поблажливість,
 * за якої вигини траси перестають рахуватися порушенням. Саме про це
 * попереджає коментар до routeNodesFromTemplate.
 */
const STRAIGHT_LINE_CORRIDOR_M = CORRIDOR_M * 2;

export type PlanVsFact = {
  /** Призначений маршрут або null, якщо на цей день його немає */
  plan: {
    templateId: string;
    name: string;
    color: string | null;
    totalDistanceKm: number | null;
    /** GeoJSON LineString для карти */
    geometry: unknown;
    stops: ResolvedRoute["stops"];
    source: "DATE" | "WEEKDAY";
  } | null;
  /**
   * Результат порівняння. null, коли порівнювати нема з чим — немає
   * плану або в треку менше двох точок.
   */
  deviation: DeviationResult | null;
  /** Ширина коридору, за якою рахували — показуємо в UI, щоб цифра не була магією */
  corridorM: number;
  /** Чи плановий маршрут мав справжню геометрію доріг, а не прямі */
  planFromGeometry: boolean;
};

/**
 * Порівнює готовий трек із планом на день.
 *
 * Окремо від resolvePlanVsFact, щоб можна було передати вже вичитані
 * точки — старі поїздки бота лежать в іншій таблиці, а логіка спільна.
 */
export function comparePlanWithTrack(
  points: AnalyzedPoint[],
  plan: ResolvedRoute | null
): PlanVsFact {
  if (!plan) {
    return { plan: null, deviation: null, corridorM: CORRIDOR_M, planFromGeometry: false };
  }

  const { nodes, fromGeometry } = routeNodesFromTemplate(plan.routeGeometry, plan.stops);
  const corridorM = fromGeometry ? CORRIDOR_M : STRAIGHT_LINE_CORRIDOR_M;

  const deviation = analyzeDeviation(toDeviationPoints(points), nodes, { corridorM });

  return {
    plan: {
      templateId: plan.templateId,
      name: plan.name,
      color: plan.color,
      totalDistanceKm: plan.totalDistanceKm,
      geometry: plan.routeGeometry,
      stops: plan.stops,
      source: plan.source,
    },
    deviation,
    corridorM,
    planFromGeometry: fromGeometry,
  };
}

/**
 * Дістає план на день і одразу порівнює з переданим треком.
 *
 * Зручний вхід для API-роутів: один виклик замість трьох.
 */
export async function resolvePlanVsFact(
  userId: string,
  day: string,
  points: AnalyzedPoint[]
): Promise<PlanVsFact> {
  const plan = await resolveRouteForDay(userId, day);
  return comparePlanWithTrack(points, plan);
}

/**
 * Приводить точки до типу, який чекає analyzeDeviation.
 *
 * Prisma віддає recordedAt як Date, але після JSON-серіалізації це вже
 * рядок — а analyzeDeviation сортує за getTime(). Тому нормалізуємо тут,
 * а не сподіваємось на тип виклику.
 */
function toDeviationPoints(points: AnalyzedPoint[]) {
  return points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    accuracyM: p.accuracyM,
    recordedAt: p.recordedAt instanceof Date ? p.recordedAt : new Date(p.recordedAt),
  }));
}

/** Вузли планової лінії для карти — щоб клієнт малював те саме, з чим порівнювали. */
export function planNodes(plan: PlanVsFact["plan"]): RouteNode[] {
  if (!plan) return [];
  return routeNodesFromTemplate(plan.geometry, plan.stops).nodes;
}
