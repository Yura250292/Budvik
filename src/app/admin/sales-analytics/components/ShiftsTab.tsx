"use client";

/**
 * Зміни торгових: одометр проти GPS.
 *
 * Головне питання екрана — чи збігається пробіг, за який платять, з
 * тим, що бачив трек. Тому обидва числа стоять поруч, а їхнє
 * співвідношення винесене окремою колонкою: одометр завжди більший
 * (трек іде по прямій між точками), і тривожить не сам розрив, а його
 * розмір.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Period } from "@/components/ui/PeriodPicker";
import { TableScroll } from "@/components/ui/TableScroll";

const ShiftTrackMap = dynamic(() => import("@/components/map/ShiftTrackMap"), {
  ssr: false,
  loading: () => <div style={{ height: 420, background: "#F3F4F6", borderRadius: 12 }} />,
});

type ShiftRow = {
  id: string;
  userId: string;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  startOdometer: number;
  endOdometer: number | null;
  startOdometerSource: string;
  endOdometerSource: string | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  gpsDistanceKm: number | null;
  stopKm: number | null;
  walkKm: number | null;
  filledKm: number | null;
  gapKm: number | null;
  odometerToGpsRatio: number | null;
  personalKm: number | null;
  odometerSuspicious: boolean;
  closedAutomatically: boolean;
  closedLate: boolean;
  /** Звідки взявся час закінчення: GPS | MANUAL | AUTO_* | OFFICE */
  lateCloseSource: string | null;
  afterWorkKm: number | null;
  confirmedAt: string | null;
  /** REP — підтвердив торговий, OFFICE — офіс */
  confirmSource: string | null;
  startPhotoUrl: string | null;
  endPhotoUrl: string | null;
  pointsCount: number;
  /** Скільки замовлень від клієнтів цього торгового того дня. */
  ordersCount: number;
  /** Перевитрата проти призначеного маршруту; null — маршруту на день немає */
  overrun: {
    plannedKm: number;
    actualKm: number;
    extraKm: number;
    overrunPct: number;
    exceeded: boolean;
  } | null;
};

type OrderDot = {
  counterpartyId: string;
  name: string;
  lat: number;
  lng: number;
  number: string;
  amount: number;
  time: string;
  draft: boolean;
};

type Detail = {
  /** Клієнти, від яких цього дня є замовлення. */
  orders: { dots: OrderDot[]; unmapped: number; total: number };
  shift: ShiftRow & { notes: string | null };
  user: { id: string; name: string };
  reads: Array<{
    id: string;
    phase: string;
    photoUrl: string | null;
    aiValue: number | null;
    aiConfidence: number | null;
    aiDigitsRead: string | null;
    rejectedReason: string | null;
    createdAt: string;
  }>;
  attempts: { start: number; end: number };
  track: {
    shift: {
      points: Array<{ lat: number; lng: number }>;
      path: Array<[number, number]>;
      /** Той самий трек, поділений на їзду, ходьбу й стоянки. */
      parts?: Array<{ mode: "DRIVE" | "WALK" | "STOP"; path: Array<[number, number]>; km: number; minutes: number; pass?: "FIRST" | "BACK" | "AGAIN"; unknown?: boolean; offRoad?: boolean }>;
      movement?: Record<"DRIVE" | "WALK" | "STOP", { km: number; minutes: number }>;
      /** Де людина стояла довше п'яти хвилин — головна відповідь на «де був». */
      stops?: Array<{
        seq: number;
        lat: number;
        lng: number;
        minutes: number;
        fromTime: string;
        toTime: string;
        counterpartyName: string | null;
      }>;
      pointsCount: number;
      /** Час останньої точки — щоб у відкритій зміні показати «де він зараз». */
      lastAt: string | null;
      lastTime: string | null;
      /** Скільки з їзди — повернення по власному сліду. */
      repeat?: { km: number; sharePct: number; backKm: number; againKm: number };
    };
    afterShift: { points: Array<{ lat: number; lng: number }>; path: Array<[number, number]>; pointsCount: number };
  };
  plan: {
    day: string;
    route: {
      templateId: string;
      name: string;
      totalDistanceKm: number | null;
      geometry: { type?: string; coordinates?: [number, number][] } | null;
      stops: Array<{ settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
      source: "DATE" | "WEEKDAY";
    } | null;
    overrun: {
      plannedKm: number;
      actualKm: number;
      extraKm: number;
      overrunPct: number;
      exceeded: boolean;
    } | null;
    thresholdPct: number;
    base: { lat: number; lng: number; address: string | null } | null;
    legs: { toFirstKm: number; fromLastKm: number; totalKm: number } | null;
    routeKm: number | null;
    coverage: { visited: number; total: number; missed: string[] } | null;
    deviation: {
      onRouteRatio: number | null;
      offRouteKm: number;
      excursions: Array<{
        minutes: number;
        km: number;
        maxDistanceM: number;
        lat: number;
        lng: number;
        fromTime: string;
        toTime: string;
      }>;
    } | null;
    corridorM: number;
    planFromGeometry: boolean;
  };
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Триває",
  CLOSED: "Закрита",
  ABANDONED: "Не закрита",
};

const SOURCE_LABEL: Record<string, string> = {
  AI: "AI",
  MANUAL: "вручну",
  CORRECTED: "AI + правка",
};

/**
 * Чому зміна закрита без фінішного фото.
 *
 * Різниця між ними — це різниця в довірі до цифри: «стояла з 19:53» —
 * це висновок з треку, а «трек мовчав» означає, що часу ми не знаємо
 * взагалі й узяли останнє, що бачили.
 */
const LATE_CLOSE_LABEL: Record<string, string> = {
  GPS: "за підказкою треку",
  MANUAL: "час вказано вручну",
  AUTO_GPS: "авто: машина стояла",
  AUTO_GAP: "авто: трек із розривом, час приблизний",
  AUTO_DEAD: "авто: трек мовчав",
  AUTO_FORCED: "авто: за часом",
  OFFICE: "закрив офіс",
};

/** Київська доба рядком «2026-08-27» — за нею групуються зміни. */
function kyivDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date(iso));
}

/** Тільки час, «09:47»: дата вже стоїть у заголовку дня. */
function clock(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * Заголовок дня. «Сьогодні» і «Вчора» словами: у списку, який дивляться
 * щодня, це швидше за «27 серпня» — око не звіряє число з календарем.
 */
function dayLabel(day: string): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(
    new Date(Date.now() - 86_400_000)
  );
  if (day === today) return "Сьогодні";
  if (day === yesterday) return "Вчора";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "numeric",
    month: "long",
    weekday: "short",
  }).format(new Date(`${day}T12:00:00Z`));
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} ${plural(d, "доба", "доби", "діб")} ${h % 24} год`;
  }
  return h > 0 ? `${h} год ${m} хв` : `${m} хв`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function sumKm(rows: ShiftRow[]): number {
  return Math.round(rows.reduce((sum, r) => sum + (r.distanceKm ?? 0), 0));
}

/**
 * Що означає число в колонці «Збіг» — одометр, поділений на трек.
 *
 * Норма тут близько ОДИНИЦІ, і так стало з 05.09.2026. До того трек рахував
 * усі метри підряд, разом із тремтінням приймача на стоянках, і виходив
 * БІЛЬШИМ за одометр — звідси й стара вилка 1..2,5. Тепер у пробіг іде лише
 * їзда на довірених фіксах, тож обидва числа міряють одне й те саме.
 *
 * Лишається природний люфт: у русі GPS трохи додає шумом, а на розривах,
 * навпаки, недобирає. Обидва боки однаково цікаві. Менше 0,8 — трек
 * намалював більше, ніж проїхала машина. Більше 1,3 — кілометри в одометрі
 * є, а треку до них немає: саме той випадок, коли день не записався.
 */
/** Як часто перемальовувати картку відкритої зміни. */
const LIVE_REFRESH_MS = 60_000;

const RATIO_MIN = 0.8;
const RATIO_MAX = 1.3;

function ratioColor(ratio: number | null): string {
  if (ratio == null) return "#9CA3AF";
  return ratio < RATIO_MIN || ratio > RATIO_MAX ? "#DC2626" : "#16A34A";
}

function ratioHint(ratio: number | null): string {
  if (ratio == null) return "Нема з чим порівняти: немає або одометра, або треку";
  if (ratio < RATIO_MIN)
    return "Трек довший за одометр: шумний приймач або домальовка розривів";
  if (ratio > RATIO_MAX)
    return "Кілометри є, а треку до них немає: запис уривався або стояв";
  return "У межах норми";
}

function time(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function ShiftsTab({
  period,
  onPeriodChange,
}: {
  period: Period;
  /**
   * Період міняє сама вкладка — заради навігатора днів.
   *
   * Пресети зверху відповідають на «як минув тиждень», а тут щодня інше
   * питання: «що було в цього дня». Гортати його стрілками треба саме
   * звідси, з-під списку змін, а не повертатися до календаря вгорі.
   */
  onPeriodChange?: (p: Period) => void;
}) {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [summary, setSummary] = useState<{
    count: number;
    totalKm: number;
    suspicious: number;
    autoClosed: number;
    unconfirmed: number;
    overrunning: number;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * Класти трек на дороги чи лишати ламаною.
   *
   * Вимкнено за замовчуванням навмисно: розрахунок коштує десятка запитів
   * до OSRM, а картку відкривають десятки разів на день. Вмикають його
   * тоді, коли справді розбирають маршрут.
   */
  /**
   * Прив'язка до доріг — увімкнена за замовчуванням.
   *
   * Була вимкнена, бо кожен розрахунок коштує запитів до OSRM. Але сира
   * ламана в місті читається як мішанина: між точками раз на двадцять секунд
   * при сорока кілометрах на годину лежить двісті метрів, і пряма ріже
   * квартали навскіс. У селі з кількома проїздами це перетворюється на
   * павутину ліній, у якій нічого не видно.
   *
   * Ризику для чисел немає: прив'язка — ЛИШЕ малюнок, пробіг рахується по
   * сирих точках (і саме тому вимкнути її можна тут же перемикачем). Шматок,
   * у якому матчер не впевнений, лишається сирою лінією, тож дір не буває.
   */
  const [onRoads, setOnRoads] = useState(true);
  /**
   * Сховати лінію й лишити самі зупинки.
   *
   * Найчистіша відповідь на «де були торгові»: жодної інтерпольованої
   * геометрії, лише виміряні місця й час у них. Лінія відповідає на інше
   * питання — «як їхав», — і саме вона приносить на карту «хвости».
   */
  const [onlyStops, setOnlyStops] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  /** Клієнт, на якому тримають курсор у списку — його кільце на карті більшає. */
  const [hoverOrder, setHoverOrder] = useState<string | null>(null);
  /**
   * Фото одометра — згорнуті.
   *
   * Досі картка починалася з двох великих квадратів, і в половини змін
   * обидва були порожні («немає фото»): екран відкривався сірою
   * пусткою, а карта, заради якої сюди й заходять, лишалась аж під нею.
   */
  const [showPhotos, setShowPhotos] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlySuspicious, setOnlySuspicious] = useState(false);
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);
  /** Форма правки в картці: одометр і час закінчення. */
  const [editOdometer, setEditOdometer] = useState("");
  const [editEndedAt, setEditEndedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ from: period.from, to: period.to });
      if (onlySuspicious) q.set("suspicious", "1");
      if (onlyUnconfirmed) q.set("confirmed", "0");
      const res = await fetch(`/api/admin/shifts?${q}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setRows(json.shifts ?? []);
      setSummary(json.summary ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити");
    }
  }, [period.from, period.to, onlySuspicious, onlyUnconfirmed]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    (async () => {
      const res = await fetch(`/api/admin/shifts/${selected}${onRoads ? "?roads=1" : ""}`);
      const json = await res.json().catch(() => null);
      if (!alive || !res.ok) return;
      setDetail(json);
      /**
       * Картка живе під таблицею, а таблиця буває на два екрани. Досі
       * клік по рядку виглядав так, ніби нічого не сталося: деталі
       * відкривались там, куди ніхто не дивиться. Тепер екран сам
       * доводить до них.
       */
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    })();
    return () => {
      alive = false;
    };
  }, [selected, onRoads]);

  /**
   * Відкрита зміна оновлюється сама.
   *
   * Питання до неї — «де він ЗАРАЗ», а відповідь на нього застаріває за
   * хвилини. Досі картку доводилося закривати й відкривати, і це виглядало
   * так, ніби людина стоїть на місці півдня. Хвилина — компроміс: точка
   * пишеться раз на 20 секунд, а кожне оновлення тягне весь трек дня.
   *
   * Закриту зміну не чіпаємо взагалі: там уже нічого не зміниться.
   */
  useEffect(() => {
    if (!selected || detail?.shift.status !== "OPEN") return;
    const timer = setInterval(() => {
      void (async () => {
        const res = await fetch(`/api/admin/shifts/${selected}${onRoads ? "?roads=1" : ""}`);
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        // Картку могли вже закрити або перемкнути на іншу зміну, поки
        // запит летів: писати відповідь у чужий стан не можна.
        if (json?.shift?.id === selected) setDetail(json);
      })();
    }, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [selected, onRoads, detail?.shift.status]);

  /**
   * Зміни, згруповані за київською добою. Порядок від нових до старих
   * зберігається — сервер уже віддав їх у ньому.
   */
  const groups = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of rows) {
      const day = kyivDay(s.startedAt);
      const bucket = map.get(day);
      if (bucket) bucket.push(s);
      else map.set(day, [s]);
    }
    return [...map.entries()];
  }, [rows]);

  /**
   * Колонка «План» з'являється, лише коли є що в ній показувати.
   * Стовпчик із самих прочерків не інформує, а забирає ширину в тих,
   * що інформують.
   */
  const hasPlans = rows.some((r) => r.overrun != null);

  const totalOrders = rows.reduce((sum, r) => sum + (r.ordersCount ?? 0), 0);

  if (error) {
    return (
      <div className="rounded-xl p-4" style={{ border: "1px solid #FECACA", background: "#FEF2F2" }}>
        <p style={{ fontSize: 13, color: "#991B1B" }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {onPeriodChange && (
        <DayNav period={period} onChange={onPeriodChange} />
      )}

      {summary && (
        <div className="flex flex-wrap items-stretch gap-2">
          <Metric label="Змін" value={String(summary.count)} />
          <Metric label="Пробіг" value={`${summary.totalKm} км`} hint="за одометром" />
          <Metric
            label="Замовлень"
            value={String(totalOrders)}
            hint={totalOrders === 0 ? "жодного" : "за ці дні"}
            color={totalOrders > 0 ? "#7C3AED" : undefined}
          />
          {/*
            Тривожні числа — не просто підпис, а фільтр: побачив «2» і
            клацнув, щоб залишились лише вони. Досі для цього треба було
            знайти окремий прапорець у кутку.
          */}
          {summary.suspicious > 0 && (
            <button
              type="button"
              onClick={() => setOnlySuspicious((v) => !v)}
              title={onlySuspicious ? "Показати всі зміни" : "Залишити лише ці"}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
            >
              <Metric
                label="Потребують уваги"
                value={String(summary.suspicious)}
                hint={onlySuspicious ? "показано лише їх ✕" : "показати лише їх"}
                color="#DC2626"
                active={onlySuspicious}
              />
            </button>
          )}
          {summary.autoClosed > 0 && (
            <Metric
              label="Закриті авто"
              value={String(summary.autoClosed)}
              hint="без фінішного фото"
              color="#D97706"
            />
          )}
          {/*
            Черга офісу: зміни, закриті без фото, яким ще ніхто не сказав
            «так було». Поки їх не звірити, кілометри в них стоять на
            здогадці треку — тому це фільтр, а не просто число.
          */}
          {summary.unconfirmed > 0 && (
            <button
              type="button"
              onClick={() => setOnlyUnconfirmed((v) => !v)}
              title={onlyUnconfirmed ? "Показати всі зміни" : "Залишити лише ці"}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
            >
              <Metric
                label="Не підтверджені"
                value={String(summary.unconfirmed)}
                hint={onlyUnconfirmed ? "показано лише їх ✕" : "показати лише їх"}
                color="#D97706"
                active={onlyUnconfirmed}
              />
            </button>
          )}
          {summary.overrunning > 0 && (
            <Metric
              label="Понад план"
              value={String(summary.overrunning)}
              hint="перевитрата кілометрів"
              color="#DC2626"
            />
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl p-6 text-center" style={{ border: "1px solid #E5E7EB", background: "#fff" }}>
          <p style={{ fontSize: 15, fontWeight: 600 }}>За цей період змін немає</p>
          <p style={{ fontSize: 13, color: "#6B7280", marginTop: 6 }}>
            Зміна створюється, коли торговий фотографує одометр у застосунку.
          </p>
        </div>
      ) : (
        <TableScroll stickyHeader className="rounded-xl border border-g200">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={th}>Торговий</th>
                <th style={th}>Час</th>
                <th style={thR} title="Різниця показів одометра — за нею платять">
                  Пробіг
                </th>
                <th style={thR} title="Скільки намалював GPS-трек">За треком</th>
                <th style={thR} title="Одометр поділити на трек. Трек завжди коротший, тож норма — від 1 до 2,5">
                  Збіг
                </th>
                <th style={thR}>Замовлень</th>
                {hasPlans && <th style={thR}>План</th>}
              </tr>
            </thead>
            {groups.map(([day, dayRows]) => (
              <tbody key={day}>
                {/*
                  Заголовок дня замість дати в кожному рядку.
                  Досі «27.08» повторювалось двічі в рядку й тринадцять
                  разів на екрані, а згрупувати зміни за днем — те, що
                  око робить першим.
                */}
                <tr>
                  <td colSpan={hasPlans ? 7 : 6} style={{ padding: "10px 12px 6px", background: "#fff" }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{dayLabel(day)}</span>
                    <span style={{ fontSize: 12, color: "#9CA3AF", marginLeft: 8 }}>
                      {dayRows.length} {plural(dayRows.length, "зміна", "зміни", "змін")}
                      {sumKm(dayRows) > 0 && ` · ${sumKm(dayRows)} км`}
                    </span>
                  </td>
                </tr>
                {dayRows.map((s) => {
                  const mine = selected === s.id;
                  const endsSameDay =
                    s.endedAt != null && kyivDay(s.endedAt) === day;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelected(mine ? null : s.id)}
                      title="Клацніть, щоб побачити маршрут і замовлення цього дня"
                      className={mine ? undefined : "hover:bg-g50"}
                      style={{
                        borderTop: "1px solid #F3F4F6",
                        cursor: "pointer",
                        background: mine ? "#F0F9FF" : s.odometerSuspicious ? "#FFFBEB" : undefined,
                      }}
                    >
                      <td style={td}>
                        {/* Смужка ліворуч у вибраного: у таблиці на два екрани
                            підсвітка тла зникає з очей, щойно доїдеш до картки. */}
                        <span
                          aria-hidden
                          style={{
                            display: "inline-block", width: 3, height: 15, borderRadius: 2,
                            marginRight: 8, verticalAlign: "-2px",
                            background: mine ? "#2563EB" : "transparent",
                          }}
                        />
                        {s.name}
                        {/* Стан — біля імені, а не в дев'ятій колонці. Мовчить
                            там, де все звично: закрита зміна це норма, а от
                            «триває» і «не закрита» треба помітити. */}
                        {s.status !== "CLOSED" && (
                          <span
                            style={{
                              marginLeft: 8, fontSize: 11, fontWeight: 600,
                              padding: "1px 7px", borderRadius: 999,
                              background: s.status === "OPEN" ? "#DCFCE7" : "#FEF3C7",
                              color: s.status === "OPEN" ? "#15803D" : "#92400E",
                            }}
                          >
                            {STATUS_LABEL[s.status] ?? s.status}
                            {s.closedAutomatically && " · авто"}
                          </span>
                        )}
                        {/* Зміна без фінішного фото чекає слова людини.
                            Підтверджена мовчить — питання закрите. */}
                        {s.closedLate && !s.confirmedAt && (
                          <span
                            style={{
                              marginLeft: 6, fontSize: 11, fontWeight: 600,
                              padding: "1px 7px", borderRadius: 999,
                              background: "#FFEDD5", color: "#9A3412",
                            }}
                            title={LATE_CLOSE_LABEL[s.lateCloseSource ?? ""] ?? "закрито без фото"}
                          >
                            не звірено
                          </span>
                        )}
                        {s.confirmedAt && (
                          <span
                            style={{ marginLeft: 6, fontSize: 11, color: "#6B7280" }}
                            title={`Підтверджено ${time(s.confirmedAt)}`}
                          >
                            ✓ {s.confirmSource === "OFFICE" ? "офіс" : "торговий"}
                          </span>
                        )}
                      </td>

                      <td style={td}>
                        <span>
                          {clock(s.startedAt)}
                          {s.endedAt
                            ? endsSameDay
                              ? ` — ${clock(s.endedAt)}`
                              : ` — ${time(s.endedAt)}`
                            : " — …"}
                        </span>
                        {s.durationMinutes != null && (
                          <span style={{ display: "block", fontSize: 11, color: "#9CA3AF" }}>
                            {duration(s.durationMinutes)}
                          </span>
                        )}
                      </td>

                      <td style={tdR}>
                        <span style={{ fontWeight: 700 }}>
                          {s.distanceKm != null ? `${s.distanceKm} км` : "—"}
                        </span>
                        <span style={{ display: "block", fontSize: 11, color: "#9CA3AF" }}>
                          {s.endOdometer != null
                            ? `${s.startOdometer.toLocaleString("uk-UA")} → ${s.endOdometer.toLocaleString("uk-UA")}`
                            : `з ${s.startOdometer.toLocaleString("uk-UA")}`}
                        </span>
                      </td>

                      <td style={tdR}>
                        {s.gpsDistanceKm != null ? `${s.gpsDistanceKm} км` : "—"}
                        <span style={{ display: "block", fontSize: 11, color: "#9CA3AF" }}>
                          {s.pointsCount === 0
                            ? "треку немає"
                            : s.stopKm != null && s.stopKm >= 1
                              ? `${s.pointsCount} точок · ${s.stopKm} км на місці`
                              : `${s.pointsCount} точок`}
                        </span>
                      </td>

                      <td
                        style={{
                          ...tdR,
                          color: ratioColor(s.odometerToGpsRatio),
                        }}
                        title={ratioHint(s.odometerToGpsRatio)}
                      >
                        {s.odometerToGpsRatio != null ? s.odometerToGpsRatio.toFixed(2) : "—"}
                      </td>

                      <td
                        style={{
                          ...tdR,
                          fontWeight: s.ordersCount > 0 ? 700 : 400,
                          color: s.ordersCount > 0 ? "#7C3AED" : "#9CA3AF",
                        }}
                      >
                        {s.ordersCount || "—"}
                      </td>

                      {hasPlans && (
                        <td
                          style={{
                            ...tdR,
                            color: s.overrun == null ? "#9CA3AF" : s.overrun.exceeded ? "#DC2626" : "#16A34A",
                            fontWeight: s.overrun?.exceeded ? 700 : 400,
                          }}
                          title={
                            s.overrun
                              ? `План ${s.overrun.plannedKm} км · Факт ${s.overrun.actualKm} км`
                              : "На цей день маршрут не призначений"
                          }
                        >
                          {s.overrun
                            ? `${s.overrun.overrunPct >= 0 ? "+" : ""}${s.overrun.overrunPct}%`
                            : "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </TableScroll>
      )}

      {detail && (
        <div
          ref={detailRef}
          className="rounded-xl p-4 space-y-4"
          style={{ border: "1px solid #E5E7EB", background: "#fff", scrollMarginTop: 12 }}
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span style={{ fontSize: 16, fontWeight: 700 }}>{detail.user.name}</span>
            <span style={{ fontSize: 13, color: "#6B7280" }}>
              {time(detail.shift.startedAt)}
              {detail.shift.endedAt && ` — ${time(detail.shift.endedAt)}`}
              {detail.shift.durationMinutes != null &&
                ` · ${Math.floor(detail.shift.durationMinutes / 60)} год ${detail.shift.durationMinutes % 60} хв`}
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={{
                marginLeft: "auto",
                fontSize: 13,
                color: "#6B7280",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              Закрити ✕
            </button>
          </div>

          {/*
            Головні числа зміни — рядком, до всього іншого.
            Раніше їх доводилось вишукувати: одометр під фотографіями,
            GPS у таблиці вище, замовлень не було ніде.
          */}
          <div className="flex flex-wrap gap-2">
            <Metric
              label="Одометр"
              value={
                detail.shift.distanceKm != null ? `${detail.shift.distanceKm} км` : "—"
              }
              hint={
                detail.shift.endOdometer != null
                  ? `${detail.shift.startOdometer.toLocaleString("uk-UA")} → ${detail.shift.endOdometer.toLocaleString("uk-UA")}`
                  : `з ${detail.shift.startOdometer.toLocaleString("uk-UA")}, кінця немає`
              }
            />
            <Metric
              label="За треком"
              value={
                detail.shift.gpsDistanceKm != null ? `${detail.shift.gpsDistanceKm} км` : "—"
              }
              /*
                Розклад по способу пересування, а не самі точки. «За треком»
                рахує всі метри підряд, і в них сидить ходьба по ринку та
                двору клієнта — тобто кілометри, яких машина не їхала. Поки
                число одне, зрозуміти, скільки з нього справжня дорога,
                неможливо.
              */
              /*
                «За треком» — це вже ЛИШЕ їзда: ходьба й тремтіння на стоянці
                в пробіг не входять із 05.09.2026. Тому підказка показує не
                склад числа, а те, що з нього ВИКИНУТО, — інакше різницю з
                учорашньою карткою нічим пояснити.
              */
              hint={
                (detail.shift.gapKm ?? 0) > 0
                  ? `з них ${detail.shift.gapKm} км — пряма через провал у даних`
                  : detail.track.shift.movement
                    ? `без ${Math.round((detail.track.shift.movement.WALK.km + detail.track.shift.movement.STOP.km) * 10) / 10} км ` +
                      `ходьби й стоянки · ${detail.track.shift.pointsCount} точок`
                    : `${detail.track.shift.pointsCount} точок`
              }
              color={(detail.shift.gapKm ?? 0) > 0 ? "#B45309" : undefined}
            />
            {detail.track.shift.repeat != null && detail.track.shift.repeat.km > 0 && (
              /*
                Єдине число в картці, з яким можна щось ЗРОБИТИ. Решта описує
                день як він був, а це показує, скільки з нього прибирається
                перекладанням порядку об'їзду.
              */
              <Metric
                label="Повторний проїзд"
                value={`${detail.track.shift.repeat.km} км`}
                hint={
                  `${detail.track.shift.repeat.sharePct}% їзди` +
                  (detail.track.shift.repeat.backKm > 0
                    ? ` · назад тією самою дорогою ${detail.track.shift.repeat.backKm} км`
                    : "")
                }
                color={detail.track.shift.repeat.sharePct >= 25 ? "#059669" : undefined}
              />
            )}
            <Metric
              label="Одометр / трек"
              value={
                detail.shift.odometerToGpsRatio != null
                  ? detail.shift.odometerToGpsRatio.toFixed(2)
                  : "—"
              }
              hint={ratioHint(detail.shift.odometerToGpsRatio)}
              color={
                detail.shift.odometerToGpsRatio == null
                  ? undefined
                  : ratioColor(detail.shift.odometerToGpsRatio)
              }
            />
            <Metric
              label="Замовлень"
              value={String(detail.orders.total)}
              hint={
                detail.orders.unmapped > 0
                  ? `${detail.orders.unmapped} без координат`
                  : "усі на карті"
              }
              color={detail.orders.total > 0 ? "#7C3AED" : undefined}
            />
          </div>

          {detail.shift.closedAutomatically && detail.shift.endOdometer == null && (
            <div className="rounded-lg p-3" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
              <p style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>
                Зміну закрито автоматично: фінішного фото немає. Час закінчення —{" "}
                {LATE_CLOSE_LABEL[detail.shift.lateCloseSource ?? ""] ?? "невідомо звідки"}.
                Одометр підтягнеться зранку зі старту наступної зміни
                {detail.shift.afterWorkKm != null &&
                  `, вечірні ${detail.shift.afterWorkKm} км уже відділені за треком`}
                .
              </p>
            </div>
          )}

          {/*
            Правка й підтвердження — те, чого адмінці бракувало найдужче.
            Досі офіс міг лише дивитися: зміна з очевидно хибним числом
            або зовсім незакрита лишалася такою назавжди, бо єдиний, хто
            мав право її змінити, — сам торговий у застосунку.
          */}
          {(detail.shift.status === "OPEN" ||
            (detail.shift.closedLate && !detail.shift.confirmedAt)) && (
            <OfficeFix
              shift={detail.shift}
              odometer={editOdometer}
              endedAt={editEndedAt}
              onOdometer={setEditOdometer}
              onEndedAt={setEditEndedAt}
              saving={saving}
              error={saveError}
              onSubmit={async (payload) => {
                setSaving(true);
                setSaveError(null);
                try {
                  const res = await fetch(`/api/admin/shifts/${detail.shift.id}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  const json = await res.json().catch(() => null);
                  if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
                  setEditOdometer("");
                  setEditEndedAt("");
                  // Перезавантажуємо і список, і картку: змінилися обидва.
                  await load();
                  const fresh = await fetch(`/api/admin/shifts/${detail.shift.id}`);
                  if (fresh.ok) setDetail(await fresh.json());
                } catch (e) {
                  setSaveError(e instanceof Error ? e.message : "Не вдалося зберегти");
                } finally {
                  setSaving(false);
                }
              }}
            />
          )}

          {detail.shift.confirmedAt && (
            <p style={{ fontSize: 12, color: "#6B7280" }}>
              Звірено {time(detail.shift.confirmedAt)} —{" "}
              {detail.shift.confirmSource === "OFFICE" ? "офісом" : "торговим у застосунку"}.
            </p>
          )}

          {detail.plan.route && <PlanVerdict plan={detail.plan} route={detail.plan.route} />}

          {/*
            Карта й список замовлень поруч: ліворуч куди їздив, праворуч
            заради чого. Нарізно вони відповідають на пів питання кожен.
          */}
          <div className="flex flex-wrap gap-4">
            <div style={{ flex: "1 1 460px", minWidth: 0 }}>
              {detail.track.shift.pointsCount > 0 ||
              detail.track.afterShift.pointsCount > 0 ||
              detail.orders.dots.length > 0 ? (
                <>
                  {/*
                    Сирий трек лишається за замовчуванням навмисно. Прив'язка
                    до доріг згладжує саме те, за чим сюди й приходять: де
                    приймач брехав і чи людина справді там була. Краса —
                    другим кроком, на прохання.
                  */}
                  <label className="mb-2 flex cursor-pointer items-center gap-2 text-[13px] text-g600">
                    <input
                      type="checkbox"
                      checked={onRoads}
                      onChange={(e) => setOnRoads(e.target.checked)}
                      className="cursor-pointer accent-primary-dark"
                    />
                    По дорогах
                    <span className="text-g500">— ходьбу й стоянки не чіпає</span>
                  </label>
                  <label className="mb-2 flex cursor-pointer items-center gap-2 text-[13px] text-g600">
                    <input
                      type="checkbox"
                      checked={onlyStops}
                      onChange={(e) => setOnlyStops(e.target.checked)}
                      className="cursor-pointer accent-primary-dark"
                    />
                    Тільки зупинки
                    <span className="text-g500">— без лінії маршруту</span>
                  </label>
                  <ShiftTrackMap
                    shiftPath={detail.track.shift.path}
                    shiftParts={detail.track.shift.parts}
                    stops={detail.track.shift.stops}
                    onlyStops={onlyStops}
                    afterShiftPath={detail.track.afterShift.path}
                    planGeometry={detail.plan.route?.geometry ?? null}
                    planStops={detail.plan.route?.stops ?? []}
                    excursions={detail.plan.deviation?.excursions ?? []}
                    orders={detail.orders.dots}
                    focusOrderId={hoverOrder}
                    base={detail.plan.base}
                    live={detail.shift.status === "OPEN"}
                    fitKey={detail.shift.id}
                    lastPointAt={detail.track.shift.lastAt}
                    lastPointTime={detail.track.shift.lastTime}
                    height="480px"
                  />
                  <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 13, marginTop: 8 }}>
                    {detail.track.shift.pointsCount > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 22, height: 3, background: "#2563EB", verticalAlign: "middle", marginRight: 6 }} />
                        Трек зміни ({detail.track.shift.pointsCount} точок)
                      </span>
                    )}
                    {(detail.track.shift.parts?.some((p) => p.unknown) ?? false) && (
                      <span title="Планшет мовчав: пряма між точками — єдине, що ми знаємо. Дорогу тут не домальовуємо навмисно: маршрутизатор веде своїм шляхом, а не тим, яким їхала людина.">
                        <span
                          style={{
                            display: "inline-block", width: 22, height: 0,
                            borderTop: "3px dashed #94A3B8", verticalAlign: "middle", marginRight: 6,
                          }}
                        />
                        Дані не доїхали (шлях невідомий)
                      </span>
                    )}
                    {(detail.track.shift.repeat?.km ?? 0) > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 22, height: 3, background: "#059669", verticalAlign: "middle", marginRight: 6 }} />
                        Назад тією самою дорогою ({detail.track.shift.repeat!.km} км)
                      </span>
                    )}
                    {detail.track.afterShift.pointsCount > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 22, height: 3, background: "#DC2626", verticalAlign: "middle", marginRight: 6 }} />
                        Після зміни ({detail.track.afterShift.pointsCount} точок)
                      </span>
                    )}
                    {(detail.track.shift.stops?.length ?? 0) > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "#111827", verticalAlign: "middle", marginRight: 6 }} />
                        Зупинки ({detail.track.shift.stops!.length})
                      </span>
                    )}
                    {detail.orders.dots.length > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 11, height: 11, borderRadius: "50%", background: "#7C3AED", verticalAlign: "middle", marginRight: 6 }} />
                        Замовлення ({detail.orders.dots.length})
                      </span>
                    )}
                    {detail.plan.route && (
                      <span>
                        <span style={{ display: "inline-block", width: 22, height: 5, background: "#16A34A", opacity: 0.45, verticalAlign: "middle", marginRight: 6 }} />
                        Маршрут за планом
                        {!detail.plan.planFromGeometry && " (прямі між пунктами)"}
                      </span>
                    )}
                    {(detail.plan.deviation?.excursions.length ?? 0) > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "2px dashed #DC2626", verticalAlign: "middle", marginRight: 6 }} />
                        Відхилення ({detail.plan.deviation!.excursions.length})
                      </span>
                    )}
                  </div>

                  {/*
                    Список зупинок — той самий день, прочитаний як
                    послідовність місць. Саме на це питання («де були
                    торгові») лінія відповідає гірше за все: між фіксами вона
                    мусить щось намалювати, і це завжди здогад. Тут здогадів
                    немає — лише виміряні місця, час і тривалість.
                  */}
                  {(detail.track.shift.stops?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                        Зупинки довші за 5 хвилин
                      </p>
                      <div className="flex flex-col" style={{ gap: 2 }}>
                        {detail.track.shift.stops!.map((stop) => (
                          <div
                            key={stop.seq}
                            className="flex items-center gap-2 rounded-md px-2 py-1"
                            style={{ fontSize: 13, background: stop.seq % 2 ? "#F9FAFB" : undefined }}
                          >
                            <span
                              style={{
                                width: 20, height: 20, borderRadius: "50%", background: "#111827",
                                color: "#fff", fontSize: 11, fontWeight: 800, flexShrink: 0,
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}
                            >
                              {stop.seq}
                            </span>
                            <span style={{ fontVariantNumeric: "tabular-nums", color: "#374151" }}>
                              {stop.fromTime}–{stop.toTime}
                            </span>
                            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 52 }}>
                              {stop.minutes} хв
                            </span>
                            <span className="truncate" style={{ color: stop.counterpartyName ? "#111827" : "#9CA3AF" }}>
                              {stop.counterpartyName ?? "клієнта поруч немає"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div
                  className="rounded-lg"
                  style={{
                    height: 200, background: "#F9FAFB", border: "1px dashed #E5E7EB",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    textAlign: "center", padding: 16,
                  }}
                >
                  <p style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.6 }}>
                    Ні треку, ні замовлень за цей день.<br />
                    Застосунок не надіслав точок — перевірте планшет у розділі «Аналітика водіїв».
                  </p>
                </div>
              )}
            </div>

            <OrdersList
              orders={detail.orders}
              hoverId={hoverOrder}
              onHover={setHoverOrder}
            />
          </div>

          {/*
            Фото одометра — під згорткою.
            Вони потрібні рівно тоді, коли число викликало сумнів, а це
            рідкість; решту часу вони займали пів екрана.
          */}
          <div>
            <button
              type="button"
              onClick={() => setShowPhotos((v) => !v)}
              style={{
                fontSize: 13, color: "#2563EB", background: "none", border: "none",
                cursor: "pointer", padding: 0,
              }}
            >
              {showPhotos ? "Сховати фото одометра" : "Показати фото одометра"}
            </button>
            {showPhotos && (
              <div className="flex flex-wrap gap-4" style={{ marginTop: 10 }}>
                {(["start", "end"] as const).map((edge) => {
                  const url = edge === "start" ? detail.shift.startPhotoUrl : detail.shift.endPhotoUrl;
                  const value = edge === "start" ? detail.shift.startOdometer : detail.shift.endOdometer;
                  const src = edge === "start" ? detail.shift.startOdometerSource : detail.shift.endOdometerSource;
                  const tries = edge === "start" ? detail.attempts.start : detail.attempts.end;
                  return (
                    <div key={edge} style={{ minWidth: 200 }}>
                      <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>
                        {edge === "start" ? "Початок зміни" : "Кінець зміни"}
                      </p>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt="Одометр"
                            style={{ width: 200, height: 130, objectFit: "cover", borderRadius: 8, border: "1px solid #E5E7EB" }}
                          />
                        </a>
                      ) : (
                        <div
                          style={{
                            width: 200, height: 130, borderRadius: 8, background: "#F3F4F6",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, color: "#9CA3AF",
                          }}
                        >
                          немає фото
                        </div>
                      )}
                      <p style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>
                        {value != null ? value.toLocaleString("uk-UA") : "—"}
                        {src && (
                          <span style={{ fontSize: 12, fontWeight: 400, color: "#6B7280" }}>
                            {" "}· {SOURCE_LABEL[src] ?? src}
                          </span>
                        )}
                      </p>
                      {tries > 1 && (
                        <p style={{ fontSize: 12, color: "#D97706" }}>перезнято {tries} рази</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {rows.length > 0 && <RepBreakdown rows={rows} truncated={rows.length >= 200} />}
    </div>
  );
}

/**
 * Одне число зміни з підписом і поясненням під ним.
 *
 * Пояснення тут не окраса: «1.85» саме по собі не каже нічого, а
 * «у межах норми» під ним знімає питання, не змушуючи згадувати, який
 * бік добрий. Кольором — лише те, що виходить за межі.
 */
/**
 * Правка зміни офісом: закрити, проставити одометр, підтвердити.
 *
 * Три дії в одній формі, бо в житті вони йдуть разом: керівник дивиться
 * на зміну, яку закрив автомат, звіряє з паперовим листом і або
 * погоджується, або вписує справжнє число. Розносити це по трьох
 * кнопках означало б змушувати робити три кліки там, де думка одна.
 */
function OfficeFix({
  shift,
  odometer,
  endedAt,
  onOdometer,
  onEndedAt,
  saving,
  error,
  onSubmit,
}: {
  shift: ShiftRow & { notes: string | null };
  odometer: string;
  endedAt: string;
  onOdometer: (v: string) => void;
  onEndedAt: (v: string) => void;
  saving: boolean;
  error: string | null;
  onSubmit: (payload: {
    endOdometer?: number;
    endedAt?: string;
    confirm?: boolean;
  }) => void | Promise<void>;
}) {
  const isOpen = shift.status === "OPEN";
  const parsed = Number(odometer.replace(/\D/g, ""));
  const hasOdometer = odometer.trim() !== "" && Number.isInteger(parsed) && parsed > 0;

  /**
   * Час у формі — місцевий рядок для <input type="datetime-local">, а
   * на сервер іде ISO. Без явного перетворення браузер віддав би час
   * без зони, і зміна закрилася б на три години раніше.
   */
  const toIso = (local: string): string | undefined =>
    local ? new Date(local).toISOString() : undefined;

  return (
    <div className="rounded-lg p-3 space-y-3" style={{ background: "#F9FAFB", border: "1px solid #E5E7EB" }}>
      <p style={{ fontSize: 13, fontWeight: 700 }}>
        {isOpen ? "Зміна досі відкрита" : "Звірити зміну"}
      </p>
      <p style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>
        {isOpen
          ? "Вкажіть, коли торговий насправді закінчив: кілометри після цього часу підуть у «дорогу додому», а не в роботу."
          : "Якщо цифри збігаються з паперовим листом — просто підтвердьте. Якщо ні — впишіть справжній одометр на кінець роботи."}
      </p>

      <div className="flex flex-wrap gap-3 items-end">
        <label style={{ fontSize: 12, color: "#374151" }}>
          <span style={{ display: "block", marginBottom: 3 }}>Час закінчення</span>
          <input
            type="datetime-local"
            value={endedAt}
            onChange={(e) => onEndedAt(e.target.value)}
            style={{
              border: "1px solid #D1D5DB", borderRadius: 8, padding: "6px 8px",
              fontSize: 13, background: "#fff",
            }}
          />
        </label>

        {!isOpen && (
          <label style={{ fontSize: 12, color: "#374151" }}>
            <span style={{ display: "block", marginBottom: 3 }}>
              Одометр на кінець, км
            </span>
            <input
              inputMode="numeric"
              value={odometer}
              onChange={(e) => onOdometer(e.target.value)}
              placeholder={`більше за ${shift.startOdometer.toLocaleString("uk-UA")}`}
              style={{
                border: "1px solid #D1D5DB", borderRadius: 8, padding: "6px 8px",
                fontSize: 13, width: 170, background: "#fff",
              }}
            />
          </label>
        )}

        <button
          type="button"
          disabled={saving || (isOpen && !endedAt)}
          onClick={() =>
            onSubmit(
              isOpen
                ? { endedAt: toIso(endedAt) }
                : {
                    ...(hasOdometer ? { endOdometer: parsed } : {}),
                    ...(endedAt ? { endedAt: toIso(endedAt) } : {}),
                    confirm: true,
                  }
            )
          }
          style={{
            padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            border: "none", cursor: saving ? "default" : "pointer",
            background: saving ? "#9CA3AF" : "#111827", color: "#fff",
          }}
        >
          {saving
            ? "Зберігаю…"
            : isOpen
              ? "Закрити зміну"
              : hasOdometer
                ? "Зберегти й підтвердити"
                : "Підтвердити як є"}
        </button>
      </div>

      {error && <p style={{ fontSize: 12, color: "#DC2626" }}>{error}</p>}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  color,
  active = false,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
  /** Плитка-фільтр, який зараз увімкнено. */
  active?: boolean;
}) {
  return (
    <div
      className="rounded-lg"
      style={{
        background: active ? "#FEF2F2" : "#F9FAFB",
        border: `1px solid ${active ? "#FECACA" : "#F3F4F6"}`,
        padding: "8px 12px",
        minWidth: 118,
        height: "100%",
      }}
    >
      <p style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </p>
      <p style={{ fontSize: 18, fontWeight: 700, color: color ?? "#0A0A0A", lineHeight: 1.2 }}>
        {value}
      </p>
      {hint && <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{hint}</p>}
    </div>
  );
}

/**
 * Замовлення дня списком — поруч із картою, а не замість неї.
 *
 * Наведення на рядок збільшує відповідне кільце на карті. Без цього
 * зв'язку список і карта лишалися б двома окремими правдами: у списку
 * прізвище, на карті цятка, а зіставляти їх — очима, по тридцять разів.
 *
 * Час підписаний як «документ», і це принципово: у 1С він означає
 * момент проведення документа, а не візиту. Офіс проводить пачками —
 * вісім замовлень о 12:24 не означають, що торговий був у восьми місцях
 * одночасно. Співставляти з треком можна МІСЦЕ, але не хвилини.
 */
function OrdersList({
  orders,
  hoverId,
  onHover,
}: {
  orders: { dots: OrderDot[]; unmapped: number; total: number };
  hoverId: string | null;
  onHover: (id: string | null) => void;
}) {
  if (orders.total === 0) {
    return (
      <aside style={{ flex: "0 1 300px", minWidth: 240 }}>
        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Замовлення дня</p>
        <div
          className="rounded-lg"
          style={{ border: "1px dashed #E5E7EB", background: "#F9FAFB", padding: 14 }}
        >
          <p style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.6 }}>
            За цей день замовлень від клієнтів цього торгового немає.
            Кілометри є, результату — ні.
          </p>
        </div>
      </aside>
    );
  }

  const total = orders.dots.reduce((sum, o) => sum + o.amount, 0);

  return (
    <aside style={{ flex: "0 1 300px", minWidth: 240 }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 700 }}>Замовлення дня · {orders.total}</p>
        <span style={{ fontSize: 12, color: "#6B7280" }}>{money.format(total)} грн</span>
      </div>

      <div
        className="rounded-lg"
        style={{ border: "1px solid #E5E7EB", maxHeight: 430, overflowY: "auto" }}
      >
        {orders.dots.map((o) => {
          const on = hoverId === o.counterpartyId;
          return (
            <div
              key={`${o.number}-${o.counterpartyId}`}
              onMouseEnter={() => onHover(o.counterpartyId)}
              onMouseLeave={() => onHover(null)}
              style={{
                padding: "8px 10px",
                borderBottom: "1px solid #F3F4F6",
                background: on ? "#F5F3FF" : undefined,
                cursor: "default",
              }}
            >
              <div className="flex items-baseline gap-2">
                <span
                  aria-hidden
                  style={{
                    width: 9, height: 9, borderRadius: "50%", flex: "none",
                    background: o.draft ? "#fff" : "#7C3AED",
                    border: "2px solid #7C3AED",
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{o.name}</span>
              </div>
              <div className="flex items-baseline justify-between" style={{ marginTop: 2, paddingLeft: 17 }}>
                <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                  документ {o.time}
                  {o.draft && " · не проведене"}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{money.format(o.amount)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {orders.unmapped > 0 && (
        <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6, lineHeight: 1.5 }}>
          Ще {orders.unmapped} замовлень у клієнтів без координат — на карту не лягли.
        </p>
      )}
    </aside>
  );
}

/**
 * Вирок за пробігом: скільки мав проїхати, скільки проїхав, наскільки більше.
 *
 * Блок свідомо великий і кольоровий лише коли поріг перетнуто. Жовта чи
 * червона панель на кожній зміні перестала б означати будь-що вже за
 * тиждень — тривожити має саме виняток.
 */
function PlanVerdict({
  plan,
  route,
}: {
  plan: Detail["plan"];
  route: NonNullable<Detail["plan"]["route"]>;
}) {
  const { overrun, deviation, thresholdPct } = plan;
  const exceeded = overrun?.exceeded ?? false;

  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: exceeded ? "#FEF2F2" : "#F0FDF4",
        border: `1px solid ${exceeded ? "#FECACA" : "#BBF7D0"}`,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span style={{ fontSize: 14, fontWeight: 700 }}>{route.name}</span>
        <span style={{ fontSize: 12, color: "#6B7280" }}>
          {route.source === "DATE" ? "разове призначення" : "постійний розклад"}
          {route.stops.length > 0 && ` · ${route.stops.length} пункт(ів)`}
        </span>
      </div>

      {/* Скільки пунктів проїхав — окремим рядком від кілометрів.
          Недоїзд і перевитрата провини різні, і один відсоток приховав би
          обидві: можна об'їхати все й накрутити зайвого, а можна не
          перевищити жодного кілометра просто нікуди не поїхавши. */}
      {plan.coverage && (
        <p style={{ fontSize: 14, marginTop: 8 }}>
          Пунктів: <b>{plan.coverage.visited} з {plan.coverage.total}</b>
          {plan.coverage.missed.length > 0 && (
            <span style={{ color: "#B45309" }}>
              {" "}· не доїхав: {plan.coverage.missed.join(", ")}
            </span>
          )}
        </p>
      )}

      {overrun ? (
        <>
          <p style={{ fontSize: 14, marginTop: 8 }}>
            План <b>{overrun.plannedKm} км</b>
            {/* Показуємо саму арифметику: інакше 264 км виглядали б числом
                нізвідки, і перевірити його було б нічим. */}
            {plan.legs && plan.routeKm != null && (
              <span style={{ color: "#6B7280", fontSize: 13 }}>
                {" "}({plan.routeKm} маршрут + {plan.legs.totalKm} подача)
              </span>
            )}{" "}
            · Факт <b>{overrun.actualKm} км</b> ·{" "}
            <span style={{ color: exceeded ? "#DC2626" : "#16A34A", fontWeight: 700 }}>
              {overrun.extraKm >= 0 ? "+" : ""}
              {overrun.extraKm} км ({overrun.overrunPct >= 0 ? "+" : ""}
              {overrun.overrunPct}%)
            </span>
          </p>
          <p
            style={{
              fontSize: 13,
              marginTop: 4,
              color: exceeded ? "#991B1B" : "#166534",
              lineHeight: 1.5,
            }}
          >
            {exceeded
              ? `Перевищення понад ${thresholdPct}% — пробіг зміни не пояснюється призначеним маршрутом.`
              : `У межах норми (до ${thresholdPct}% понад план).`}
          </p>
        </>
      ) : (
        <p style={{ fontSize: 13, color: "#6B7280", marginTop: 8 }}>
          {/* Без планових км порівнювати нема з чим — і мовчати про це не можна:
              інакше «немає перевищення» читалося б як «усе добре». */}
          У маршруту не пораховані планові кілометри, тож перевитрату не
          порахувати. Карта нижче все одно накладе плановий напрямок.
        </p>
      )}

      {/* Без бази план занижений рівно на подачу — і мовчати про це не
          можна: інакше кожен, хто живе не в першому пункті, виглядав би
          винним просто за дорогу на роботу. */}
      {!plan.base && (
        <p style={{ fontSize: 13, marginTop: 8, color: "#B45309", lineHeight: 1.5 }}>
          Подача не врахована: у торгового не вказана база (звідки виїжджає).
          План занижений на дорогу до маршруту й назад. Адреса заводиться у
          вкладці «Логістика → Пальне».
        </p>
      )}
      {plan.base && !plan.legs && (
        <p style={{ fontSize: 13, marginTop: 8, color: "#B45309", lineHeight: 1.5 }}>
          Подачу не порахували: OSRM не відповів. План показано без неї —
          відкрийте зміну ще раз, щоб спробувати знову.
        </p>
      )}

      {deviation && (deviation.excursions.length > 0 || deviation.offRouteKm > 0) && (
        <p style={{ fontSize: 13, marginTop: 8, color: "#374151", lineHeight: 1.5 }}>
          Поза коридором ±{(plan.corridorM / 1000).toFixed(1)} км:{" "}
          <b>{deviation.offRouteKm} км</b>
          {deviation.excursions.length > 0 && (
            <>
              {" "}· значущих епізодів: <b>{deviation.excursions.length}</b> (
              {deviation.excursions
                .map((e) => `${e.fromTime}—${e.toTime}, ${e.km} км`)
                .join("; ")}
              )
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Навігатор по днях.
 *
 * Пресети зверху («7 днів», «Цей місяць») відповідають на питання про
 * період. Але щодня в офісі питають інше — «а що було в цього дня»: чому
 * зміна закрилась о 22:00, куди їздив у вівторок, чи виїхав узагалі.
 * Гортати дні через календар угорі означає щоразу тицяти дві дати.
 *
 * Тому стрілки, поле дати й «Сьогодні» стоять просто над списком змін.
 * Коли обрано період із кількох днів, поле показує його останній день і
 * підписує, скільки днів показано, — інакше стрілка мовчки перетворила б
 * місяць на добу й це виглядало б як зникнення даних.
 */
function DayNav({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  const single = period.from === period.to;
  const day = period.to;
  const span = Math.round(
    (Date.parse(`${period.to}T12:00:00Z`) - Date.parse(`${period.from}T12:00:00Z`)) / 86_400_000
  ) + 1;

  const go = (d: string) => onChange({ from: d, to: d });
  const shift = (delta: number) => {
    const t = new Date(`${day}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + delta);
    go(t.toISOString().slice(0, 10));
  };

  const btn: React.CSSProperties = {
    border: "1px solid #E5E7EB",
    background: "#fff",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    cursor: "pointer",
    lineHeight: 1,
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" style={btn} onClick={() => shift(-1)} title="Попередній день" aria-label="Попередній день">
        ‹
      </button>
      <input
        type="date"
        value={day}
        max={today}
        onChange={(e) => e.target.value && go(e.target.value)}
        style={{ ...btn, padding: "6px 8px", cursor: "text" }}
      />
      <button
        type="button"
        style={btn}
        onClick={() => shift(1)}
        disabled={day >= today}
        title="Наступний день"
        aria-label="Наступний день"
      >
        ›
      </button>
      <button
        type="button"
        style={{ ...btn, fontWeight: single && day === today ? 700 : 400 }}
        onClick={() => go(today)}
      >
        Сьогодні
      </button>
      <span style={{ fontSize: 12, color: "#9CA3AF" }}>
        {single
          ? "один день — стрілками гортати сусідні"
          : `показано ${span} ${plural(span, "день", "дні", "днів")} · стрілка або дата залишать один`}
      </span>
    </div>
  );
}

/**
 * Аналіз змін по торгових: разом і кожен окремо.
 *
 * Список вище відповідає на питання про КОНКРЕТНУ зміну, а це — про
 * людину за період. Числа тут не нові: вони складені з тих самих рядків,
 * що вже прийшли, і другого джерела правди не заводять.
 *
 * Головна колонка — «Збіг»: пробіг за одометром, поділений на пробіг за
 * треком, ЗА ПЕРІОД. Саме вона відрізняє людину, у якої кілометри
 * сходяться, від тієї, у кого планшет не бачить неба, — і від тієї, у
 * кого кілометри є, а треку до них немає.
 *
 * Ділимо суми, а не усереднюємо готові відношення змін. Дві причини.
 * Перша: число стоїть упритул до власних доданків, і читач ділить їх
 * очима — медіана 0,85 поруч із «953 км» і «796 км» виглядала б
 * помилкою екрана. Друга: у зміни відношення буває незаповнене, і такі
 * зміни випадали б із оцінки мовчки. Саме так Ігор Джумага показував
 * прочерк, маючи 468 км одометра проти 108 за треком — найгірший рядок
 * таблиці був єдиним без оцінки.
 */
function RepBreakdown({ rows, truncated }: { rows: ShiftRow[]; truncated: boolean }) {
  const reps = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        shifts: number;
        days: Set<string>;
        minutes: number;
        odometerKm: number;
        trackKm: number;
        orders: number;
        suspicious: number;
        unconfirmed: number;
        overrunning: number;
        open: number;
      }
    >();

    for (const r of rows) {
      let a = map.get(r.userId);
      if (!a) {
        a = {
          id: r.userId,
          name: r.name,
          shifts: 0,
          days: new Set(),
          minutes: 0,
          odometerKm: 0,
          trackKm: 0,
          orders: 0,
          suspicious: 0,
          unconfirmed: 0,
          overrunning: 0,
          open: 0,
        };
        map.set(r.userId, a);
      }
      a.shifts += 1;
      a.days.add(kyivDay(r.startedAt));
      a.minutes += r.durationMinutes ?? 0;
      a.odometerKm += r.distanceKm ?? 0;
      a.trackKm += r.gpsDistanceKm ?? 0;
      a.orders += r.ordersCount ?? 0;
      if (r.odometerSuspicious) a.suspicious += 1;
      if (r.closedLate && !r.confirmedAt) a.unconfirmed += 1;
      if (r.overrun?.exceeded) a.overrunning += 1;
      if (r.status === "OPEN") a.open += 1;
    }

    return [...map.values()]
      .map((a) => ({
        ...a,
        daysWorked: a.days.size,
        ratio: a.trackKm > 0 ? a.odometerKm / a.trackKm : null,
        kmPerDay: a.days.size ? Math.round(a.odometerKm / a.days.size) : 0,
        kmPerOrder: a.orders > 0 ? a.odometerKm / a.orders : null,
      }))
      .sort((x, y) => y.odometerKm - x.odometerKm);
  }, [rows]);

  const total = useMemo(
    () => ({
      shifts: reps.reduce((s, r) => s + r.shifts, 0),
      daysWorked: reps.reduce((s, r) => s + r.daysWorked, 0),
      minutes: reps.reduce((s, r) => s + r.minutes, 0),
      odometerKm: reps.reduce((s, r) => s + r.odometerKm, 0),
      trackKm: reps.reduce((s, r) => s + r.trackKm, 0),
      orders: reps.reduce((s, r) => s + r.orders, 0),
      attention: reps.reduce((s, r) => s + r.suspicious + r.unconfirmed + r.overrunning, 0),
    }),
    [reps]
  );

  const totalRatio = total.trackKm > 0 ? total.odometerKm / total.trackKm : null;

  if (reps.length === 0) return null;

  return (
    <div className="rounded-xl" style={{ border: "1px solid #E5E7EB", background: "#fff" }}>
      <div style={{ padding: "14px 16px 8px" }}>
        <p style={{ fontSize: 15, fontWeight: 700 }}>Аналіз змін по торгових</p>
        <p style={{ fontSize: 12, color: "#6B7280", marginTop: 4, lineHeight: 1.5 }}>
          За обраний період. «Збіг» — пробіг за одометром, поділений на пробіг за
          треком: трек іде по прямій між точками й завжди коротший, тож норма
          приблизно від 1 до 2,5. Менше одиниці означає помилку в показах
          одометра, більше — що кілометри є, а треку до них немає.
        </p>
        {truncated && (
          <p style={{ fontSize: 12, color: "#B45309", marginTop: 6 }}>
            Показано перші 200 змін періоду — для довшого періоду підсумки неповні.
          </p>
        )}
      </div>
      <TableScroll minWidth={860}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              <th style={th}>Торговий</th>
              <th style={thR}>Змін</th>
              <th style={thR}>Днів</th>
              <th style={thR}>Годин</th>
              <th style={thR} title="За одометром — те, за що платять">Пробіг</th>
              <th style={thR}>Км/день</th>
              <th style={thR} title="Скільки намалював GPS-трек">За треком</th>
              <th style={thR}>Збіг</th>
              <th style={thR}>Замовлень</th>
              <th style={thR} title="Скільки кілометрів припало на одне замовлення">Км/зам.</th>
              <th style={thR} title="Підозрілий одометр, не підтверджені зміни, перевитрата понад план">
                Уваги
              </th>
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => {
              const attention = r.suspicious + r.unconfirmed + r.overrunning;
              return (
                <tr key={r.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {r.name}
                    {r.open > 0 && (
                      <span style={{ fontSize: 11, color: "#2563EB", marginLeft: 6 }}>у дорозі</span>
                    )}
                  </td>
                  <td style={tdR}>{r.shifts}</td>
                  <td style={tdR}>{r.daysWorked}</td>
                  <td style={tdR}>{(r.minutes / 60).toFixed(1)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{Math.round(r.odometerKm)}</td>
                  <td style={tdR}>{r.kmPerDay || "—"}</td>
                  <td style={{ ...tdR, color: "#6B7280" }}>{Math.round(r.trackKm) || "—"}</td>
                  <td style={{ ...tdR, color: ratioColor(r.ratio) }} title={ratioHint(r.ratio)}>
                    {r.ratio != null ? r.ratio.toFixed(2) : "—"}
                  </td>
                  <td style={tdR}>{r.orders || "—"}</td>
                  <td style={tdR}>{r.kmPerOrder != null ? r.kmPerOrder.toFixed(0) : "—"}</td>
                  <td style={{ ...tdR, color: attention > 0 ? "#DC2626" : "#9CA3AF" }}>
                    {attention || "—"}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid #E5E7EB", background: "#F9FAFB" }}>
              <td style={{ ...td, fontWeight: 700 }}>Разом</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{total.shifts}</td>
              {/*
                «Днів» у підсумку — це людино-дні, а не календарні дні:
                четверо в полі одного дня дають чотири. Саме це число
                ділить пробіг у «Км/день», тож інша сума тут збрехала б.
              */}
              <td style={{ ...tdR, fontWeight: 700 }}>{total.daysWorked}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{(total.minutes / 60).toFixed(1)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{Math.round(total.odometerKm)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>
                {total.daysWorked ? Math.round(total.odometerKm / total.daysWorked) : "—"}
              </td>
              <td style={{ ...tdR, fontWeight: 700, color: "#6B7280" }}>
                {Math.round(total.trackKm) || "—"}
              </td>
              <td
                style={{ ...tdR, fontWeight: 700, color: ratioColor(totalRatio) }}
                title={ratioHint(totalRatio)}
              >
                {totalRatio != null ? totalRatio.toFixed(2) : "—"}
              </td>
              <td style={{ ...tdR, fontWeight: 700 }}>{total.orders || "—"}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>
                {total.orders > 0 ? (total.odometerKm / total.orders).toFixed(0) : "—"}
              </td>
              <td style={{ ...tdR, fontWeight: 700, color: total.attention > 0 ? "#DC2626" : "#9CA3AF" }}>
                {total.attention || "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 13, color: "#374151" };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "10px 12px" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };
