"use client";

/**
 * Хто зараз на маршруті — карта в реальному часі + звірка дня.
 *
 * Дві речі, яких не давав жоден звіт. Перша — «де зараз водій»: досі це
 * з'ясовували дзвінком. Друга — звірка трьох джерел за один день:
 * маршрутний лист 1С каже, скільки кілометрів і боргів планували, трек
 * каже, скільки проїхали насправді, відмітки — скільки грошей забрали.
 *
 * Карта і список стоять поруч, а не одне під одним: вибір людини — це
 * головна дія екрана, і заради неї не має бути прокрутки. Усе, що
 * стосується вже обраної людини, зібрано в деталі під ними
 * (LivePersonDetail); тут лишилися дані, полінг і розкладка.
 *
 * Пробіг по треку рахується по прямій між точками, тому він завжди
 * НИЖЧИЙ за дорогу. Відсоток показуємо, але висновок лишаємо людині:
 * поріг «скільки це нормально» залежить від маршруту, і вписувати його в
 * код зарано — спершу треба місяць реальних даних.
 */

import { useCallback, useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { Skeleton } from "@/components/ui/Skeleton";
import { LivePeopleList } from "./LivePeopleList";
import { LivePersonDetail } from "./LivePersonDetail";

const TrackDayMap = dynamic(() => import("@/components/map/TrackDayMap"), {
  ssr: false,
  // Висоту тримає обгортка, тому плейсхолдер просто заповнює її: інакше
  // при зміні розкладки довелося б правити ще й це число.
  loading: () => <div className="h-full w-full animate-pulse rounded-[var(--radius-card)] bg-g100" />,
});

export type Person = {
  userId: string;
  name: string;
  role: string;
  color: string | null;
  /** null — точок сьогодні ще не було. Людина в списку, але не на карті. */
  lat: number | null;
  lng: number | null;
  speedKmh: number | null;
  lastPointAt: string | null;
  minutesAgo: number | null;
  online: boolean;
  distanceKm: number;
  pointsCount: number;
  shift: {
    status: string;
    startedAt: string;
    endedAt: string | null;
    /** Хвилин відкритої зміни без жодної точки — головна цифра тривоги. */
    silentSinceStartMin: number | null;
  } | null;
  /** Що планшет каже про себе сам. null — пульсу ще не було. */
  device: {
    minutesAgo: number | null;
    alive: boolean;
    tracking: boolean;
    buffered: number;
    lastFixMinutesAgo: number | null;
    lastFixAccuracyM: number | null;
    batteryPct: number | null;
    deviceName: string | null;
    appVersion: string | null;
    lastError: string | null;
  } | null;
  /** Скільки клієнтів цієї людини сьогодні замовили. */
  ordersToday: number;
  /** Збірка на планшеті — відома навіть без пульсу, з User-Agent кабінету. */
  installedVersion: string | null;
  /** Готова фраза «чому не пишеться» або null, якщо все гаразд. */
  problem: string | null;
};

export type DayDetail = {
  user: { id: string; name: string; role: string };
  track: {
    distanceKm: number;
    pointsCount: number;
    startedAt: string | null;
    lastPointAt: string | null;
    points: Array<{ lat: number; lng: number; recordedAt: string; speedKmh: number | null }>;
    /** Лінія з добитими розривами — сирий трек як він є. */
    path: Array<[number, number]>;
    /**
     * Та сама лінія, покладена на граф вулиць (map matching).
     * null — коли прив'язати не вдалося; тоді малюємо сиру.
     */
    roadPath: Array<[number, number]> | null;
    /**
     * Де людина стояла довше кількох хвилин — і в кого саме.
     *
     * Те саме, що на карті зміни торгового. Питання «де був водій» лінією
     * відповідається погано: між двома фіксами вона мусить щось намалювати.
     */
    stops: Array<{
      seq: number;
      lat: number;
      lng: number;
      minutes: number;
      fromTime: string;
      toTime: string;
      counterpartyId: string | null;
      counterpartyName: string | null;
      distanceM: number | null;
    }>;
    /** Той самий трек, поділений на їзду, ходьбу й стоянки. */
    parts?: Array<{
      mode: "DRIVE" | "WALK" | "STOP";
      path: Array<[number, number]>;
      km: number;
      minutes: number;
    }>;
    partsOnRoads: boolean;
    /** Скільки з денного пробігу — їзда, скільки ходьба, скільки стоянка */
    movement: Record<"DRIVE" | "WALK" | "STOP", { km: number; minutes: number }>;
    /** Точки поза робочим вікном: записані, але не показані */
    hiddenPoints: number;
    workHours: string;
  };
  /** Призначений маршрут торгового на цей день. У водія null. */
  plan: {
    templateId: string;
    name: string;
    color: string | null;
    totalDistanceKm: number | null;
    geometry: unknown;
    stops: Array<{ settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
    source: "DATE" | "WEEKDAY";
  } | null;
  deviation: {
    hasRoute: boolean;
    onRouteRatio: number | null;
    offRouteKm: number;
    excursions: Array<{
      from: string;
      to: string;
      minutes: number;
      km: number;
      maxDistanceM: number;
      lat: number;
      lng: number;
    }>;
    pointsAnalyzed: number;
  } | null;
  corridorM: number;
  /** Чи план мав справжню геометрію доріг, а не прямі між пунктами */
  planFromGeometry: boolean;
  route: {
    source: string;
    number: string | null;
    /** Плановий пробіг маршруту сайту (OSRM). null — маршруту сайту немає. */
    plannedKm: number | null;
    /** Фактичний пробіг, який офіс вніс руками в журналі листів. */
    actualKm: number | null;
    stops: Array<{
      key: string;
      name: string;
      lat: number | null;
      lng: number | null;
      sequence: number;
      debtAmount: number;
      visit: { status: string; collectedAmount: number | null } | null;
    }>;
  };
  visits: Array<{
    id: string;
    status: string;
    comment: string | null;
    collectedAmount: number | null;
    markedAt: string;
    counterparty: { name: string };
  }>;
  /** Клієнти, від яких сьогодні є замовлення. */
  orders: {
    dots: Array<{
      counterpartyId: string;
      name: string;
      lat: number;
      lng: number;
      number: string;
      amount: number;
      time: string;
      draft: boolean;
    }>;
    /** Замовлення, у клієнтів яких немає координат: на карту не лягли. */
    unmapped: number;
    total: number;
  };
  sheet1C: {
    number: string;
    distanceKm: number;
    ordersTotal: number;
    debtsTotal: number;
    collected: number;
  } | null;
};

/** Як часто перепитуємо, хто де. Частіше немає сенсу: планшет шле пачку раз на 25 с. */
const POLL_MS = 30_000;

function kyivToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
}

export function LiveTrackTab() {
  const [day, setDay] = useState(kyivToday);
  /** Малювати трек по вулицях, а не ламаною між фіксами. */
  const [onRoads, setOnRoads] = useState(true);
  /**
   * Сховати лінію й лишити самі зупинки.
   *
   * Найчистіша відповідь на «де він був»: жодної інтерпольованої геометрії,
   * лише виміряні місця й час у них. Той самий перемикач, що в зміні
   * торгового.
   */
  const [onlyStops, setOnlyStops] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  /**
   * Деталі показуємо лише тоді, коли вони про того, кого зараз обрано.
   *
   * Поки відповідь на нову людину в дорозі, у стані ще лежить попередня —
   * і без цієї перевірки на карті пів секунди світився б чужий маршрут.
   */
  const shown = detail && detail.user.id === selected ? detail : null;
  const [error, setError] = useState<string | null>(null);

  const loadLive = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/track/live?day=${day}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setPeople(json.people ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити");
    }
  }, [day]);

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  // Опитування лише на сьогоднішній день: минулі дні не змінюються.
  useEffect(() => {
    if (day !== kyivToday()) return;
    const id = window.setInterval(() => void loadLive(), POLL_MS);
    return () => window.clearInterval(id);
  }, [day, loadLive]);

  /**
   * Порядковий номер запиту деталей.
   *
   * Відповіді приходять не в тому порядку, в якому пішли: клацнув одного,
   * одразу іншого — і повільніша відповідь першого лягла б поверх
   * другого. Приймаємо лише найсвіжішу.
   */
  const detailReq = useRef(0);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    const token = ++detailReq.current;
    try {
      // parts і roads просимо лише для обраної людини: поділ треку тягне
      // за собою OSRM, а список опитується раз на пів хвилини.
      const res = await fetch(
        `/api/admin/track/${selected}/day?day=${day}&parts=1${onRoads ? "&roads=1" : ""}`
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      if (token === detailReq.current) setDetail(json as DayDetail);
    } catch (e) {
      if (token === detailReq.current) {
        setError(e instanceof Error ? e.message : "Не вдалося завантажити день");
      }
    }
  }, [selected, day, onRoads]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  /**
   * Маршрут теж оновлюється сам, а не лише при виборі людини.
   *
   * Досі лінію дня тягнули один раз — коли на людину клацнули. Точка на
   * карті рухалася кожні пів хвилини, а слід за нею стояв на місці, і
   * виглядало це рівно як «трек завис і перестав малюватись»; варто було
   * переклацнути людину — і лінія доганяла. Тепер її оновлює той самий
   * цикл, що й позиції.
   */
  useEffect(() => {
    if (!selected || day !== kyivToday()) return;
    const id = window.setInterval(() => void loadDetail(), POLL_MS);
    return () => window.clearInterval(id);
  }, [selected, day, loadDetail]);

  const isToday = day === kyivToday();

  /** Хто має координати — тільки їх можна намалювати. */
  const onMap = people.filter(
    // minutesAgo звужуємо разом із координатами: якщо точка є, то є й час
    // її запису — карта підписує ним маркер.
    (p): p is Person & { lat: number; lng: number; minutesAgo: number } =>
      p.lat != null && p.lng != null && p.minutesAgo != null
  );
  /** Хто вимагає уваги: екран існує заради цього рядка. */
  const troubled = people.filter((p) => p.problem);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            setSelected(null);
          }}
          className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-3 py-2 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
        />
        {/*
          Прив'язка до доріг — за замовчуванням увімкнена, але вимикається.
          Сирий трек мусить лишатися під рукою: саме за ним видно, де приймач
          брехав, а прив'язка це якраз згладжує. Коли розбираєш «чи він там
          був», потрібна правда, а не краса.
        */}
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-g600">
          <input
            type="checkbox"
            checked={onRoads}
            onChange={(e) => setOnRoads(e.target.checked)}
            className="cursor-pointer accent-primary-dark"
          />
          По дорогах
        </label>
        {/* Лише зупинки: коли треба відповісти «де стояв», а не «як їхав» */}
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-g600">
          <input
            type="checkbox"
            checked={onlyStops}
            onChange={(e) => setOnlyStops(e.target.checked)}
            className="cursor-pointer accent-primary-dark"
          />
          Тільки зупинки
        </label>
        {isToday && <span className="text-[13px] text-g500">Оновлюється кожні 30 с</span>}
      </div>

      {error && <ErrorBox message={error} />}

      {people.length === 0 ? (
        <Card>
          <EmptyState
            title={isToday ? "Сьогодні ще ніхто не виїхав" : "Цього дня треків немає"}
            hint="Трек пишеться, коли водій відкриває «Карту дня» на планшеті."
          />
        </Card>
      ) : (
        <>
          {/*
            Висоту задають ОБИДВІ клітинки однаковим класом. Якби вона
            стояла лише на карті, довгий список розтягнув би рядок сітки —
            а з ним і карту, заради компактності якої все й робилося.
          */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
            {/* Рамку й скруглення тримає сама карта (MapFrame) — другий
                контейнер із overflow тут лише подвоював би заокруглення. */}
            <div className="h-[280px] rounded-[var(--radius-card)] border border-g200 lg:h-[clamp(340px,48vh,460px)]">
              <TrackDayMap
                /* На карту йдуть лише ті, у кого сьогодні була хоч одна
                   точка. Решта лишається в списку — саме там видно, що
                   планшет мовчить, і саме це треба помітити. */
                people={onMap}
                selectedId={selected}
                detail={
                  shown
                    ? {
                        points: shown.track.points,
                        path:
                          onRoads && shown.track.roadPath
                            ? shown.track.roadPath
                            : shown.track.path,
                        parts: shown.track.parts,
                        trackStops: shown.track.stops,
                        stops: shown.route.stops,
                        plan: shown.plan,
                        excursions: shown.deviation?.excursions ?? [],
                        orders: shown.orders?.dots ?? [],
                      }
                    : null
                }
                // «Тільки зупинки» ховає лінію, але не піни: саме вони й
                // лишаються відповіддю на питання «де був».
                onlyStops={onlyStops}
                onSelect={setSelected}
                height="100%"
              />
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white lg:h-[clamp(340px,48vh,460px)] lg:overflow-y-auto lg:overscroll-contain">
              <LivePeopleList
                people={people}
                selectedId={selected}
                onSelect={setSelected}
                troubledCount={troubled.length}
              />
            </div>
          </div>

          {selected && !shown && (
            <Card>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-3 h-8 w-full" />
              <Skeleton className="mt-2 h-8 w-2/3" />
            </Card>
          )}

          {shown && (
            <LivePersonDetail detail={shown} day={day} onClose={() => setSelected(null)} />
          )}

          {!selected && (
            <p className="text-xs text-g400">
              Оберіть людину в списку — з&apos;являться її трек на карті, звірка з
              маршрутним листом і відмітки дня.
            </p>
          )}
        </>
      )}
    </div>
  );
}
