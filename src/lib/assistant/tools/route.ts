/**
 * Маршрут для керівника: за конкретними точками або на весь день.
 *
 * Два режими живуть в одному інструменті навмисно: у керівника вже 23
 * інструменти-стеля (кожен коштує токени в КОЖНОМУ ході розмови), тому нову
 * можливість додаємо режимом (mode), як у stock_health чи money_flows, а не
 * двадцять четвертим інструментом.
 *
 * mode="stops" — людина вже знає перелік точок: клієнти з бази, адреси
 * текстом, слово «склад» — і хоче лише порядок обʼїзду, кілометри й
 * посилання, з якого починається навігація. Правила ті самі, що й у
 * кодовій відповіді торгового (route-build.ts): неоднозначні імена не
 * зупиняють роботу, а перелічуються внизу. Кілометри й хвилини — лише від
 * OSRM; коли дороги немає, чесно віддаємо порядок за відстанню й порожні
 * числа, а не «приблизно» по прямій: саме з вигаданих кілометрів колись
 * починалися суперечки про пробіг. Старт — там, де людина зараз (див.
 * assistant/here.ts), бо маршрут у чаті власник будує собі: він сам їде
 * по точках. Склад — коли так сказано, або коли місця людини не знаємо.
 *
 * mode="day_plan" — керівник не називає точок сам, а просить «розкинути
 * доставку по водіях» чи «скласти маршрути на завтра». Ядро для цього вже
 * є — buildDayPlan (routes/build-day-plan.ts), та сама логіка, що стоїть
 * за вкладкою «План» на /admin/logistics/delivery. Тут лише розв'язуємо
 * імена водіїв у id (ядро про базу User не знає, а менеджер каже «Пайда»,
 * не id) і перекладаємо відповідь людською мовою. Інструмент нічого не
 * пише: чернетки маршрутів створює людина натиском на екрані, а тут —
 * лише план і посилання туди.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { day as validDay, enumOf, str, ToolArgError } from "@/lib/assistant/validate";
import { resolveRouteStops, type RouteStop } from "@/lib/assistant/facts/route-build";
import { accuracyLabel, HERE_MAX_ACCURACY_M } from "@/lib/assistant/here";
import { orderStops, type RouteLeg } from "@/lib/assistant/facts/day-plan";
import { WEEKDAY_ACCUSATIVE } from "@/lib/assistant/facts/route-habits";
import { defaultDepot } from "@/lib/routes/depot";
import { buildDayPlan } from "@/lib/routes/build-day-plan";
import { googleMapsLinksFromHere } from "@/lib/maps/google-links";
import { getRoute } from "@/lib/geo/osrm";
import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";

const MIN_STOPS = 2;
const MAX_STOPS = 20;
const NAME_MIN = 2;
const NAME_MAX = 80;

/**
 * Старт «від мене»: так модель передає прохання людини почати з її місця.
 * Лише цілі фрази — «Яремче» чи «Ямпіль» не повинні стати геолокацією.
 */
const HERE_WORD = /^(я|мене|від мене|звідси|тут|де я|моє місце|моя (гео)?локація|поточна (гео)?локація|геолокація|з мого місця)$/i;

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
    "Два режими. mode=\"stops\" (за замовчуванням): порядок обʼїзду за названими точками — клієнти з бази, адреси текстом, слово «склад»; повертає порядок, кілометри й хвилини від OSRM і посилання Google Maps. mode=\"day_plan\": СКЛАДАЄ МАРШРУТИ ВОДІЯМ НА ДЕНЬ — сам бере непривезені реалізації, ділить їх між водіями за історією доставок, шикує порядок, рахує гроші кожного рейсу (вал, пальне за нормою машини з дорогою назад, оплата водію, скільки лишається фірмі), дає посилання Google Maps і каже, що відкласти. Викликай day_plan на «склади маршрути на завтра», «розкинь доставку по водіях», «кому що везти завтра», «чи окупиться рейс»; stops — на «як обʼїхати …», «маршрут по Стрию: …».",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["stops", "day_plan"],
        description: "stops — порядок за названими точками; day_plan — план доставки на день. Без поля — stops.",
      },
      stops: {
        type: "array",
        items: { type: "string" },
        minItems: MIN_STOPS,
        maxItems: MAX_STOPS,
        description: "Тільки для mode=stops. Точки маршруту: назви клієнтів, адреси або «склад». Від 2 до 20.",
      },
      start: {
        type: "string",
        description: "Тільки для mode=stops. Звідки виїжджати: клієнт, адреса, «склад» або «я» (поточна геолокація людини). Без цього поля старт — поточна геолокація людини, якщо пристрій її дав, інакше склад. НЕ питай людину, де вона: місце інструмент бере сам.",
      },
      date: {
        type: "string",
        description: "Тільки для mode=day_plan. День у форматі YYYY-MM-DD. Без цього — завтра.",
      },
      drivers: {
        type: "array",
        items: { type: "string" },
        description: "Тільки для mode=day_plan. Імена водіїв, якщо людина назвала їх сама. Без цього — усі, хто возив за два тижні.",
      },
    },
    required: [],
  },
  async run(ctx, args) {
    const mode = enumOf(args.mode, "mode", ["stops", "day_plan"] as const, "stops");

    if (mode === "day_plan") {
      const date = validDay(args.date, "date", kyivDate(new Date(Date.now() + 86_400_000)));
      const names = Array.isArray(args.drivers)
        ? args.drivers.filter((v): v is string => typeof v === "string" && v.trim() !== "")
        : [];
      const dayNotes: string[] = [];

      // Імена водіїв розв'язуємо тут, а не в ядрі: buildDayPlan не знає про
      // базу User, а модель називає людей так, як їх називає менеджер —
      // «Пайда», а не id. Не знайшли жодного — краще сказати про це прямо,
      // ніж мовчки побудувати план на всіх водіїв замість названих.
      let driverIds: string[] | undefined;
      if (names.length) {
        const matched = await prisma.user.findMany({
          where: { role: "DRIVER", OR: names.map((n) => ({ name: { contains: n, mode: "insensitive" as const } })) },
          select: { id: true, name: true },
        });
        if (matched.length === 0) {
          return { помилка: `Водія з іменем ${names.map((n) => `«${n}»`).join(", ")} серед водіїв не знайшов.` };
        }
        const unresolved = names.filter(
          (n) => !matched.some((d) => d.name.toLowerCase().includes(n.trim().toLowerCase()))
        );
        if (unresolved.length) {
          dayNotes.push(
            `${unresolved.map((n) => `«${n}»`).join(", ")} серед водіїв не знайшов — план лише по тих, кого впізнав.`
          );
        }
        driverIds = matched.map((d) => d.id);
      }

      const plan = await buildDayPlan({ date, driverIds });
      if ("error" in plan) return { помилка: plan.error };

      const money = plan.routes.map((r) => r.economics);
      const sumOf = (pick: (e: (typeof money)[number]) => number | null) =>
        money.some((e) => pick(e) === null) ? null : money.reduce((s, e) => s + (pick(e) ?? 0), 0);

      return {
        дата: plan.date,
        маршрути: plan.routes.map((r) => ({
          водій: r.driverName,
          точок: r.stops.length,
          сума: Math.round(r.stops.reduce((s, x) => s + x.amount, 0)),
          км_до_останньої_точки: r.distanceKm === null ? null : Math.round(r.distanceKm),
          км_за_день_з_дорогою_назад: r.roundTripKm === null ? null : Math.round(r.roundTripKm),
          звично_км_за_день: r.normalKm === null ? null : Math.round(r.normalKm),
          хвилин: r.durationMin === null ? null : Math.round(r.durationMin),
          гроші_рейсу: {
            вал: r.economics.margin,
            вал_частково_оцінено: r.economics.marginEstimated || undefined,
            собівартість_відома_відсотків: Math.floor(r.economics.costedShare * 100),
            пальне: r.economics.fuel,
            норма_пального: r.fuel.own
              ? `${r.fuel.consumption} на 100 км × ${r.fuel.pricePerUnit} ₴ (машина водія) +${r.fuel.bufferPercent ?? 0}%`
              : `${r.fuel.consumption} л/100 км × ${r.fuel.pricePerUnit} ₴ (типове авто, машину водія не заведено) +${r.fuel.bufferPercent ?? 0}%`,
            водію: r.economics.driverPay,
            точок_вигрузки_місто: r.economics.cityPoints,
            точок_вигрузки_область: r.economics.oblastPoints,
            лишається_фірмі: r.economics.result,
          },
          підстава: r.reason,
          порядок: r.stops.map((s) => ({ n: s.sequence, назва: s.name, адреса: s.address, сума: Math.round(s.amount) })),
          // Навігація від складу по точках у порядку плану. Google вміщує ~10
          // точок на посилання, тому довгий маршрут іде кількома частинами.
          посилання_google: googleMapsLinksFromHere(
            r.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
            plan.depot ? { lat: plan.depot.lat, lng: plan.depot.lng } : null
          ).map((l) => ({ url: l.url, точок: l.points })),
        })),
        разом: {
          сума: Math.round(plan.routes.reduce((s, r) => s + r.stops.reduce((a, x) => a + x.amount, 0), 0)),
          вал: sumOf((e) => e.margin),
          пальне: sumOf((e) => e.fuel),
          водіям: sumOf((e) => e.driverPay),
          лишається_фірмі: sumOf((e) => e.result),
        },
        відкладені: plan.deferred.map((d) => ({
          причина: d.reason,
          зазвичай_їде: d.suggestWeekday === null ? null : WEEKDAY_ACCUSATIVE[d.suggestWeekday],
          точки: d.points.map((p) => p.name),
        })),
        без_координат: plan.noPin.map((p) => p.name),
        не_наша_розвозка: plan.outOfZone.map((p) => p.name),
        // Саме номер, а не технічний ідентифікатор: для документа без
        // контрагента це єдина зачіпка, за якою його знайдуть у 1С.
        без_контрагента: plan.noCounterparty.map((p) => p.number),
        свої_не_розвозка: plan.internal.map((p) => `${p.name} (${p.number})`),
        посилання: `/admin/logistics/delivery?tab=plan&day=${plan.date}`,
        примітка: [
          ...dayNotes,
          ...plan.notes,
          "Гроші рейсу: вал накладних (сума мінус собівартість) − пальне на повний день з дорогою назад − оплата водію за формулою зарплати = лишається фірмі. Відкладені точки в ці числа не входять. Waze багатоточкових маршрутів за посиланням не приймає — для навігації по точках давай посилання Google.",
          "План поки нікуди не записаний. Щоб створити чернетки маршрутів, людина відкриває посилання й тисне «Створити маршрути».",
        ].join(" "),
      };
    }

    const names = stopsArg(args.stops);
    const startName = str(args.start, "start", { min: NAME_MIN, max: NAME_MAX, required: false });
    const repId = ctx.scope.repId;
    const notes: string[] = [];

    /* ── Старт ─────────────────────────────────────────────────────── */

    let start: (Point & { source: RouteStop["source"] | "геолокація" }) | null = null;

    /*
     * Де людина — якщо пристрій чи трек це знають і похибка придатна.
     * Грубу позицію (ноутбук за IP) не беремо: перший рукав «+3 км» від
     * точки, якої насправді немає, гірший за чесний старт зі складу.
     */
    const here = ctx.here;
    const hereUsable = here && (here.accuracyM === null || here.accuracyM <= HERE_MAX_ACCURACY_M) ? here : null;
    const hereWhy = !here
      ? "вашого місця не знаю — пристрій не дав геолокацію"
      : !hereUsable
        ? `геолокація надто груба (${accuracyLabel(here.accuracyM)}: пристрій визначив місце за мережею, а не GPS)`
        : null;
    const fromHere = (): Point & { source: "геолокація" } => ({
      name: "Ваша геолокація",
      lat: hereUsable!.lat,
      lng: hereUsable!.lng,
      id: null,
      source: "геолокація",
    });
    const hereNote = () =>
      `Старт — ваша поточна геолокація (${accuracyLabel(hereUsable!.accuracyM)}, ${hereUsable!.source === "трек" ? "з треку застосунку" : "з пристрою"}). Щоб рахувати від складу, скажіть «від складу».`;

    if (startName && HERE_WORD.test(startName.trim())) {
      if (hereUsable) {
        start = fromHere();
        notes.push(hereNote());
      } else {
        notes.push(`Старт «від мене» не вийшов: ${hereWhy}. Виїжджаємо зі складу.`);
      }
    } else if (startName) {
      const found = await resolveRouteStops([startName], repId, { geocode: true, maxGeocode: 1 });
      const s = found.picked[0];
      if (s) start = { name: s.name, lat: s.lat, lng: s.lng, id: s.id, source: s.source };
      else notes.push(`Старт «${startName}» не впізнав — виїжджаємо зі складу.`);
    } else if (hereUsable) {
      start = fromHere();
      notes.push(hereNote());
    } else {
      notes.push(`Старт — склад: ${hereWhy}.`);
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

    /*
     * «Без координат» ≠ «не знайшли».
     *
     * Клієнт у базі є, але в картці немає пінa, тож у порядок обʼїзду він
     * стати не може. Без цього рядка модель переказує обидва списки як
     * «такого клієнта немає» — і людина йде шукати неіснуючу помилку
     * замість того, щоб поставити точку на карті.
     */
    if (resolved.noPin.length) {
      notes.push(
        `${resolved.noPin.map((n) => `«${n}»`).join(", ")} — клієнт у базі Є, але в картці немає точки на карті, тому в порядок обʼїзду не став; поставити пін можна на карті клієнтів.`
      );
    }

    /*
     * Невпізнаний клієнт — привід перепитати, а не сказати «немає в базі».
     *
     * 23.09.2026 модель відповіла власникові «Яцків не знайдено, перевірте
     * назву в 1С», хоча клієнт був — «Яцьків». Тепер разом із невпізнаним
     * іменем іде список схожих, і модель має запропонувати їх людині.
     */
    if (resolved.suggestions.length) {
      notes.push(
        "Невпізнаних НЕ називай відсутніми в базі: для них є схожі клієнти в «можливо_мали_на_увазі» — запитай людину, котрого з них вона мала на увазі, і запропонуй ці назви як варіанти відповіді."
      );
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
        можливо_мали_на_увазі: resolved.suggestions.length
          ? resolved.suggestions.map((x) => ({ ви_назвали: x.asked, варіанти: x.options }))
          : undefined,
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
      можливо_мали_на_увазі: resolved.suggestions.length
        ? resolved.suggestions.map((x) => ({ ви_назвали: x.asked, варіанти: x.options }))
        : undefined,
      без_координат: resolved.noPin,
      примітка: notes.join(" "),
    };
  },
};
