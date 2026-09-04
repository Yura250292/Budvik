/**
 * Повний трек людини за день + її відмітки візитів.
 *
 * Розбір польотів постфактум: керівник відкриває день і бачить, де водій
 * був насправді (трек), куди мав заїхати (точки маршруту) і що там
 * сталося за його словами (візити). Розбіжність між цими трьома шарами і
 * є предметом розмови.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { attachVisits, resolveDriverDay, type DayStop } from "@/lib/track/day-stops";
import { buildTrackPath } from "@/lib/track/gaps";
import { classifyMovement, movementTotals } from "@/lib/track/movement";
import { splitByMovement } from "@/lib/track/movement-parts";
import { findStops, type StopCandidate } from "@/lib/track/stops";
import { ordersTodayForRep } from "@/lib/track/orders-today";
import { resolvePlanVsFact } from "@/lib/track/plan-vs-fact";
import { onlyWorkingHours, WORK_HOURS_LABEL } from "@/lib/track/work-hours";
import { matchDayPath } from "@/lib/track/road-match";
import { kyivTime } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

/**
 * Через скільки нових точок перекладаємо трек на дороги заново.
 *
 * Умова була «кількість змінилася» — а на живому дні вона змінюється
 * щохвилини, і сторінка опитує цей роут раз на пів хвилини. Тобто кожне
 * відкриття вкладки «На маршруті» гнало десяток запитів у публічний OSRM,
 * який лімітований, і робило це по колу весь день. Двадцять точок — це
 * приблизно пʼять хвилин руху: хвіст за цей час домальовується сирою
 * ламаною, і на око різниці немає.
 */
const REMATCH_EVERY_POINTS = 20;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { userId } = await params;
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || kyivDate(new Date());
  const dayStart = kyivDayStart(day);
  /**
   * Поділ треку на їзду й ходьбу — на прохання.
   *
   * Сам поділ дешевий (чиста арифметика), але з `roads=1` він тягне за
   * собою OSRM, а сторінка перепитує цей роут раз на пів хвилини. Тому
   * клієнт просить його лише тоді, коли людину обрано.
   */
  const wantParts = url.searchParams.get("parts") === "1";
  /**
   * Класти їзду на дороги — теж на прохання, як у картці зміни: розрахунок
   * коштує десятка запитів до OSRM.
   */
  const onRoads = url.searchParams.get("roads") === "1";

  const [user, trackSession, points, visits, route, orders] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, color: true },
    }),
    prisma.trackSession.findUnique({
      where: { userId_day: { userId, day: dayStart } },
      select: {
        distanceKm: true,
        pointsCount: true,
        startedAt: true,
        lastPointAt: true,
        roadPath: true,
        roadPathPoints: true,
        id: true,
      },
    }),
    prisma.trackPoint.findMany({
      where: { userId, session: { day: dayStart } },
      orderBy: { recordedAt: "asc" },
      select: {
        lat: true,
        lng: true,
        recordedAt: true,
        speedKmh: true,
        accuracyM: true,
        gapGeometry: true,
      },
    }),
    prisma.visit.findMany({
      where: { userId, day: dayStart },
      orderBy: { markedAt: "asc" },
      include: { counterparty: { select: { name: true, deliveryLat: true, deliveryLng: true } } },
    }),
    resolveDriverDay(userId, day),
    ordersTodayForRep(userId, day),
  ]);

  if (!user) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // Пробіг з 1С за той самий день — головна звірка вкладки: маршрутний
  // лист каже одне, GPS інше. Трек по прямій завжди коротший за дорогу,
  // тому висновок робить людина, а не поріг у коді.
  const sheet = await prisma.routeSheet.findFirst({
    where: { driverId: userId, date: { gte: dayStart, lte: new Date(dayStart.getTime() + 86_399_999) } },
    select: { number: true, distanceKm: true, ordersTotal: true, debtsTotal: true },
  });

  /**
   * Порівняння з призначеним маршрутом. Рахується щоразу заново — план
   * можна перепризначити заднім числом, і збережений колись результат
   * розійшовся б із тим, що бачить керівник на карті.
   *
   * У водіїв призначень зазвичай немає (їхній план — маршрутний лист із
   * 1С, він уже в route), тому plan просто буде null і блок не з'явиться.
   */
  /**
   * Показуємо лише робочі години. Пристрій пише цілодобово — щоб не
   * втратити ранній виїзд і не мати дірок, — але на карті нічний дрейф
   * GPS у дворі торгового малював би поїздки, яких не було.
   *
   * Скільки саме сховано, віддаємо окремим числом: тиха фільтрація, про
   * яку ніхто не знає, гірша за відсутність фільтра.
   */
  const workPoints = onlyWorkingHours(points);
  const hiddenPoints = points.length - workPoints.length;

  const planVsFact = await resolvePlanVsFact(userId, day, workPoints);

  /**
   * Лінія, покладена на дороги.
   *
   * Рахується лише тоді, коли точок побільшало з минулого разу, — інакше
   * кожне відкриття дня коштувало б десятка запитів до публічного OSRM. Не
   * вдалося (сервер мовчить, ліміт) — карта просто малює сиру лінію, як досі.
   */
  let roadPath: Array<[number, number]> | null = asPath(trackSession?.roadPath);
  const pointsNow = workPoints.length;
  const cachedFor = trackSession?.roadPathPoints ?? null;
  /**
   * Перекладати заново варто, лише коли трек справді підріс.
   *
   * Було «кількість не збігається» — тобто на живому дні ІСТИННО завжди, і
   * кожне з опитувань раз на пів хвилини гнало десяток запитів у публічний
   * OSRM. Минулий день рахуємо один раз і назавжди; сьогоднішній — раз на
   * двадцять нових точок, а хвіст між перерахунками домальовуємо сирою
   * ламаною: на око це та сама лінія.
   */
  const isToday = day === kyivDate(new Date());
  const stale =
    cachedFor == null || (isToday ? pointsNow - cachedFor >= REMATCH_EVERY_POINTS : cachedFor !== pointsNow);

  if (trackSession && pointsNow >= 2 && stale) {
    const matched = await matchDayPath(workPoints).catch(() => null);
    if (matched) {
      roadPath = matched;
      await prisma.trackSession
        .update({
          where: { id: trackSession.id },
          data: { roadPath: matched, roadPathPoints: pointsNow },
        })
        .catch(() => null);
    }
  } else if (roadPath && cachedFor != null && cachedFor < pointsNow) {
    // Хвіст після останнього перерахунку — сирою лінією, приклеєною до
    // кешованої. Інакше свіжі кілометри просто не малювалися б, і виглядало
    // б це рівно як «трек завис».
    const tail = buildTrackPath(workPoints.slice(Math.max(0, cachedFor - 1)));
    if (tail.length >= 2) roadPath = [...roadPath, ...tail.slice(1)];
  }

  /**
   * Де водій СТОЯВ — те саме, що вже рахується для торгового.
   *
   * Лінія відповідає на це погано за побудовою: між двома фіксами вона
   * мусить щось намалювати, і це завжди здогад. Зупинка здогадів не
   * потребує — це місце, з якого людина не виходила, і час, який вона там
   * пробула. Для водія питання ще прямолінійніше: скільки він простояв на
   * вивантаженні і в кого саме.
   *
   * Клієнтів для підпису беремо спершу з маршруту (там вони точно ті, до
   * кого він мав заїхати), потім із замовлень дня.
   */
  const candidates = stopCandidates(route.stops, orders.dots);
  const stops = findStops(workPoints, candidates).map((s) => ({
    ...s,
    // Час форматує сервер: київська доба одна, а браузер бухгалтера буває в
    // іншій зоні.
    fromTime: kyivTime(s.from),
    toTime: kyivTime(s.to),
  }));

  const parts = wantParts ? await splitByMovement(workPoints, onRoads) : undefined;

  return NextResponse.json({
    day,
    user,
    track: {
      distanceKm: trackSession ? Math.round(trackSession.distanceKm * 10) / 10 : 0,
      pointsCount: trackSession?.pointsCount ?? 0,
      startedAt: trackSession?.startedAt ?? null,
      lastPointAt: trackSession?.lastPointAt ?? null,
      points: workPoints,
      /**
       * Готова лінія для карти: там, де планшет був офлайн, замість прямої
       * через півміста вплетено реальну дорогу. Окремим полем, а не
       * замість points: точки несуть швидкість і точність, які потрібні
       * для розбору «стояв чи їхав».
       */
      path: buildTrackPath(workPoints),
      /**
       * Та сама дорога, але покладена на граф вулиць. Окремим полем, а не
       * замість path: сирий трек мусить лишатися доступним — саме за ним
       * видно, де приймач брехав, а прив'язка це якраз ховає.
       */
      roadPath,
      /**
       * Де людина стояла довше кількох хвилин — і в кого саме.
       *
       * Те саме, що на карті зміни торгового: питання «де були» лінією
       * відповідається погано, а зупинка — це виміряне місце й час.
       */
      stops,
      /** Той самий трек, поділений на їзду, ходьбу й стоянки. */
      parts,
      partsOnRoads: onRoads,
      /** Скільки з денного пробігу — їзда, скільки ходьба, скільки стоянка */
      movement: movementTotals(classifyMovement(workPoints)),
      /** Скільки точок сховано як неробочі — щоб фільтр не був таємним */
      hiddenPoints,
      workHours: WORK_HOURS_LABEL,
    },
    // Точки з приклеєними відмітками — карта фарбує їх за статусом візиту
    // так само, як планшет у водія.
    route: { ...route, stops: attachVisits(route.stops, visits) },
    // Плановий маршрут торгового і відхилення від нього. Для водія — null.
    plan: planVsFact.plan,
    deviation: planVsFact.deviation,
    corridorM: planVsFact.corridorM,
    planFromGeometry: planVsFact.planFromGeometry,
    visits,
    /**
     * Клієнти, від яких сьогодні є замовлення. Шар поверх маршруту:
     * поруч видно, куди людина доїхала і що з того вийшло.
     */
    orders,
    sheet1C: sheet
      ? {
          number: sheet.number,
          distanceKm: sheet.distanceKm,
          ordersTotal: sheet.ordersTotal,
          debtsTotal: sheet.debtsTotal,
          collected: visits.reduce((s, v) => s + (v.collectedAmount ?? 0), 0),
        }
      : null,
  });
}

/**
 * Кого можна підписати під зупинкою.
 *
 * Спершу точки маршруту: до них водій і мав заїхати, і назва там та сама,
 * що в дні. Потім клієнти із замовленнями дня — вони пояснюють зупинки, яких
 * у маршруті не було. Один клієнт — один кандидат: якщо він і в маршруті, і
 * в замовленнях, виграє маршрут.
 *
 * Бонусна поїздка клієнта не має взагалі («Пошта», «Забрати ремонт»), тож
 * для неї ключем служить сама точка — інакше найпомітніша зупинка дня
 * лишилася б без підпису.
 */
function stopCandidates(
  routeStops: DayStop[],
  dots: Array<{ counterpartyId: string; name: string; lat: number | null; lng: number | null }>
): StopCandidate[] {
  const byKey = new Map<string, StopCandidate>();

  for (const s of routeStops) {
    if (s.lat == null || s.lng == null) continue;
    const key = s.counterpartyId ?? `ds:${s.deliveryStopId ?? s.key}`;
    if (byKey.has(key)) continue;
    byKey.set(key, { counterpartyId: key, name: s.name, lat: s.lat, lng: s.lng });
  }

  for (const d of dots) {
    if (d.lat == null || d.lng == null) continue;
    if (byKey.has(d.counterpartyId)) continue;
    byKey.set(d.counterpartyId, {
      counterpartyId: d.counterpartyId,
      name: d.name,
      lat: d.lat,
      lng: d.lng,
    });
  }

  return [...byKey.values()];
}

/** Обережне читання кеша: у Json могло лежати що завгодно зі старих версій. */
function asPath(value: unknown): Array<[number, number]> | null {
  if (!Array.isArray(value)) return null;
  const out: Array<[number, number]> = [];
  for (const v of value) {
    if (!Array.isArray(v) || v.length < 2) return null;
    const [lat, lng] = v;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    out.push([lat, lng]);
  }
  return out.length >= 2 ? out : null;
}
