/**
 * Маршрут за конкретними точками — для керівника.
 *
 * Це не план дня. План дня торгового живе в розмові «як торговий» і сам
 * вирішує, куди їхати; тут людина вже знає перелік — клієнти, адреси,
 * склад — і хоче лише порядок обʼїзду, кілометри й посилання, з якого
 * починається навігація.
 *
 * Правила ті самі, що й у кодовій відповіді торгового (route-build.ts):
 * неоднозначні імена не зупиняють роботу, а перелічуються внизу. Кілометри
 * й хвилини — лише від OSRM; коли дороги немає, чесно віддаємо порядок за
 * відстанню й порожні числа, а не «приблизно» по прямій: саме з вигаданих
 * кілометрів колись починалися суперечки про пробіг.
 *
 * Старт — склад, якщо не сказано інакше. У керівника немає «своєї останньої
 * точки треку», а розвозка виїжджає зі складу.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { str, ToolArgError } from "@/lib/assistant/validate";
import { resolveRouteStops, type RouteStop } from "@/lib/assistant/facts/route-build";
import { orderStops, type RouteLeg } from "@/lib/assistant/facts/day-plan";
import { defaultDepot } from "@/lib/routes/depot";
import { googleMapsLinksFromHere } from "@/lib/maps/google-links";
import { getRoute } from "@/lib/geo/osrm";

const MIN_STOPS = 2;
const MAX_STOPS = 20;
const NAME_MIN = 2;
const NAME_MAX = 80;

/** Скільки адрес геокодуємо за один виклик (Nominatim ~1,1 с на запит). */
const MAX_GEOCODE = 5;

/**
 * Список точок з аргументів моделі.
 *
 * Модель час від часу шле перелік одним рядком через кому замість масиву —
 * розбираємо, а не відкидаємо: зайвий раунд «виправ формат» коштує
 * людині кілька секунд і нічого не додає.
 */
function stopsArg(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,;\n]/)
      : null;
  if (!list) throw new ToolArgError("Поле «stops» має бути списком назв точок: клієнти, адреси або «склад»");

  const names = list
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .map((v, i) => str(v, `stops[${i + 1}]`, { min: NAME_MIN, max: NAME_MAX }));

  if (names.length < MIN_STOPS) {
    throw new ToolArgError(`Для маршруту потрібно щонайменше ${MIN_STOPS} точки, а прийшло ${names.length}`);
  }
  if (names.length > MAX_STOPS) {
    throw new ToolArgError(`Забагато точок: ${names.length}, а за раз можна не більше ${MAX_STOPS}`);
  }
  return names;
}

type Point = { name: string; lat: number; lng: number; id: string | null };

/** Та сама точка з точністю ~30 м — зайвий нульовий рукав OSRM не потрібен. */
function samePoint(a: Point, b: Point): boolean {
  if (a.id && b.id) return a.id === b.id;
  return Math.abs(a.lat - b.lat) < 0.0003 && Math.abs(a.lng - b.lng) < 0.0003;
}

/**
 * Одна точка — orderStops до OSRM не ходить (шикувати нема чого), а
 * кілометри й час людині однаково потрібні. Тому дорогу до єдиної точки
 * питаємо самі.
 */
async function singleLeg(
  start: Point,
  stop: RouteStop
): Promise<{ km: number | null; minutes: number | null; source: "osrm" | "відстань"; legs: RouteLeg[] | null }> {
  try {
    const route = await getRoute([
      [start.lng, start.lat],
      [stop.lng, stop.lat],
    ]);
    const leg = route.legs[0];
    return {
      km: route.totalDistanceKm,
      minutes: route.totalDurationMin,
      source: "osrm",
      legs: leg ? [{ km: leg.distanceKm, min: leg.durationMin }] : null,
    };
  } catch {
    return { km: null, minutes: null, source: "відстань", legs: null };
  }
}

export const buildRouteTool: ToolDef = {
  name: "build_route",
  label: "Будую маршрут",
  kinds: ["ADMIN"],
  description:
    "Маршрут за названими точками від складу: клієнти з бази (прізвища чи назви досить), адреси текстом («вул. Шевченка 10, Стрий»), слово «склад». Повертає порядок обʼїзду, кілометри й хвилини від OSRM, плече від попередньої точки і посилання Google Maps. 2–20 точок. Викликай на «побудуй/склади маршрут: …», «як обʼїхати …», «маршрут по Стрию: …». Не для плану дня торгового — це розмова «як торговий».",
  parameters: {
    type: "object",
    properties: {
      stops: {
        type: "array",
        items: { type: "string" },
        minItems: MIN_STOPS,
        maxItems: MAX_STOPS,
        description: "Точки маршруту: назви клієнтів, адреси або «склад». Від 2 до 20.",
      },
      start: {
        type: "string",
        description: "Звідки виїжджати: клієнт, адреса або «склад». Без цього — склад.",
      },
    },
    required: ["stops"],
  },
  async run(ctx, args) {
    const names = stopsArg(args.stops);
    const startName = str(args.start, "start", { min: NAME_MIN, max: NAME_MAX, required: false });
    const repId = ctx.scope.repId;
    const notes: string[] = [];

    /* ── Старт ─────────────────────────────────────────────────────── */

    let start: (Point & { source: RouteStop["source"] }) | null = null;
    if (startName) {
      const found = await resolveRouteStops([startName], repId, { geocode: true, maxGeocode: 1 });
      const s = found.picked[0];
      if (s) start = { name: s.name, lat: s.lat, lng: s.lng, id: s.id, source: s.source };
      else notes.push(`Старт «${startName}» не впізнав — виїжджаємо зі складу.`);
    }
    if (!start) {
      const depot = await defaultDepot();
      if (depot) start = { name: depot.name, lat: depot.lat, lng: depot.lng, id: null, source: "склад" };
    }

    /* ── Точки ─────────────────────────────────────────────────────── */

    const resolved = await resolveRouteStops(names, repId, { geocode: true, maxGeocode: MAX_GEOCODE });
    let stops = resolved.picked;

    if (!start) {
      // Складу з координатами немає — їдемо від першої впізнаної точки.
      const first = stops[0];
      if (first) {
        start = { name: first.name, lat: first.lat, lng: first.lng, id: first.id, source: first.source };
        stops = stops.slice(1);
        notes.push(`Складу з координатами в базі немає — старт із першої точки «${first.name}».`);
      }
    } else {
      // «Склад» у переліку, коли старт і так склад, — це та сама точка.
      const dropped = stops.filter((s) => samePoint(start!, s));
      if (dropped.length) {
        stops = stops.filter((s) => !samePoint(start!, s));
        notes.push(`${dropped.map((s) => `«${s.name}»`).join(", ")} — це точка старту, з порядку прибрано.`);
      }
    }

    if (resolved.geocodeSkipped.length) {
      notes.push(
        `Адрес геокодую не більше ${MAX_GEOCODE} за раз — ${resolved.geocodeSkipped.map((n) => `«${n}»`).join(", ")} назвіть окремим викликом.`
      );
    }

    if (!start || stops.length === 0) {
      return {
        помилка: start
          ? "Крім старту, жодну точку на карту поставити не вдалося"
          : "Жодну з названих точок не вдалося поставити на карту: не знайшли або в картці немає координат",
        старт: start ? { назва: start.name, широта: start.lat, довгота: start.lng } : null,
        нерозпізнані: resolved.unclear,
        без_координат: resolved.noPin,
        примітка: notes.join(" ") || undefined,
      };
    }

    /* ── Порядок ───────────────────────────────────────────────────── */

    let order: RouteStop[];
    let km: number | null;
    let minutes: number | null;
    let source: "osrm" | "відстань";
    let legs: RouteLeg[] | null;

    if (stops.length === 1) {
      order = stops;
      ({ km, minutes, source, legs } = await singleLeg(start, stops[0]));
    } else {
      const route = await orderStops(stops, start);
      order = route?.order ?? stops;
      km = route?.km ?? null;
      minutes = route?.minutes ?? null;
      source = route?.source ?? "відстань";
      legs = route?.legs ?? null;
    }

    const links = googleMapsLinksFromHere(
      order.map((s) => ({ lat: s.lat, lng: s.lng })),
      { lat: start.lat, lng: start.lng }
    );

    notes.push(
      source === "osrm"
        ? `Порядок і кілометри — OSRM, від «${start.name}».`
        : "Дорогу порахувати не вдалося (OSRM мовчить): порядок за відстанню по прямій, кілометрів і часу немає."
    );

    return {
      старт: { назва: start.name, широта: start.lat, довгота: start.lng },
      порядок: order.map((s, i) => ({
        n: i + 1,
        назва: s.name,
        адреса: s.address,
        клієнт_id: s.id,
        km_від_попередньої: legs?.[i]?.km ?? null,
        хв_від_попередньої: legs?.[i]?.min ?? null,
      })),
      км: km,
      хвилин: minutes,
      джерело: source === "osrm" ? "OSRM" : "за відстанню",
      посилання_google: links.map((l) => ({ url: l.url, точок: l.points })),
      нерозпізнані: resolved.unclear,
      без_координат: resolved.noPin,
      примітка: notes.join(" "),
    };
  },
};
