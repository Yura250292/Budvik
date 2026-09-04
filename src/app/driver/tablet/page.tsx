"use client";

/**
 * Мій день: список точок маршруту, відмітки візитів і каса.
 *
 * Головний екран водія. Карти тут навмисно немає: возити маршрут по
 * власній карті означало тримати планшет у вебі заради треку — а трек
 * тепер пише нативний застосунок у фоні. Тому дорогу водій відкриває у
 * звичному Google Maps, а сюди повертається, щоб відмітити точку.
 *
 * Кнопки великі: у них цілять пальцем, іноді на ходу.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import {
  flushPendingVisits,
  listPendingVisits,
  queueVisit,
} from "@/lib/track/pending-visits";
import { useTrackRecorder } from "@/hooks/useTrackRecorder";
import { useBuildVersion } from "@/hooks/useBuildVersion";
import { useIsNativeApp } from "@/lib/useIsNativeApp";
import {
  batchNavigateUrl,
  googleMapsLinksFromHere,
  navigateUrl,
  type NavApp,
} from "@/lib/maps/google-links";
import { NAV_BATCHES, useAutoNext, useNavApp, useNavBatch, type NavBatch } from "@/lib/maps/use-nav-app";
import { haversineM } from "@/lib/track/geo";
import { RouteChip, RouteSheet, formatRouteDay } from "@/components/driver/RoutePicker";
import { kyivToday } from "@/components/ui/PeriodPicker";
import type { DayStop } from "@/lib/track/day-stop-type";

type Handover = {
  id: string;
  amount: number;
  handedAt: string;
  confirmedAt: string | null;
  confirmedAmount: number | null;
  comment: string | null;
};

type DayResp = {
  day: string;
  role: string;
  route: {
    source: "ROUTE_SHEET" | "DELIVERY_ROUTE" | "NONE";
    /** Ключ листа для адреси й карти: `dr:<id>` / `rs:<id>` */
    id: string | null;
    day: string | null;
    /** Точки розкладено за порядком, який водій склав собі на карті */
    myOrder?: boolean;
    number: string | null;
    /**
     * Чий це лист. Водій бачить листи колег, і відмітки в них заборонені —
     * без імені власника чужий маршрут виглядав би як свій.
     */
    mine?: boolean;
    driverName?: string | null;
    vehicle: string | null;
    plannedKm: number | null;
    stops: DayStop[];
  };
  progress: {
    total: number;
    done: number;
    missed: number;
    left: number;
    collected: number;
    debtPlanned: number;
  };
  track: {
    distanceKm: number;
    pointsCount: number;
    lastPointAt: string | null;
  };
  cash: {
    collected: number;
    handed: number;
    onHands: number;
    handovers: Handover[];
  };
};

/** «1 точка / 3 точки / 10 точок» — на кнопці неправильна форма ріже око. */
function pointsLabel(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  if (!teen && last === 1) return `${n} точка`;
  if (!teen && last >= 2 && last <= 4) return `${n} точки`;
  return `${n} точок`;
}

/**
 * Ближче за це — водій уже приїхав.
 *
 * Сто п'ятдесят метрів — це двір і сусідній під'їзд, але вже не сусідній
 * квартал; та сама межа, за якою трек підписує зупинку клієнтом
 * (lib/track/stops.ts). Ширше — і підказка почала б спрацьовувати на
 * проїзді повз.
 */
const ARRIVE_M = 150;

/** Що показує індикатор треку в шапці. */
const TRACK_BADGE: Record<string, { dot: string; label: string }> = {
  live: { dot: "#16A34A", label: "Трек іде" },
  buffering: { dot: "#D97706", label: "Немає звʼязку" },
  denied: { dot: "#DC2626", label: "Немає доступу до GPS" },
  unsupported: { dot: "#DC2626", label: "GPS недоступний" },
  idle: { dot: "#9CA3AF", label: "Трек вимкнено" },
};

/**
 * Suspense обов'язковий: екран читає відкритий маршрут із адреси
 * (useSearchParams), а без межі очікування Next вимагає рендерити
 * динамічно всю сторінку.
 */
export default function DriverDayPage() {
  return (
    <Suspense
      fallback={
        <p className="px-4 py-6" style={{ color: "#9CA3AF", fontSize: "14px" }}>
          Завантаження…
        </p>
      }
    >
      <DriverDayScreen />
    </Suspense>
  );
}

function DriverDayScreen() {
  const router = useRouter();
  const params = useSearchParams();
  /** null — сьогоднішній маршрут, який сервер знайде сам. */
  const routeKey = params.get("route");
  /**
   * Доба без номера листа — так приходять з історії маршрутів, де рядок
   * знає лише дату. Ключ маршруту сильніший: якщо він є, дата зайва.
   */
  const dayKey = routeKey ? null : params.get("day");

  const [data, setData] = useState<DayResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [queued, setQueued] = useState<string[]>([]);

  const isApp = useIsNativeApp();
  /**
   * У застосунку трек пише нативна служба: вона переживає і згорнуту
   * вкладку, і вихід у Google Maps. Веб-рекордер там був би другим
   * джерелом тих самих координат — зайвий шум у пробігу.
   */
  const track = useTrackRecorder({ enabled: !isApp });
  const build = useBuildVersion();

  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * Чим водій їде. Живе на пристрої, а не в профілі: це звичка конкретної
   * людини за конкретним кермом, і синхронізувати її між планшетом і
   * телефоном немає навіщо.
   */
  const [navApp, chooseNav] = useNavApp();
  const [batch, chooseBatch] = useNavBatch();
  const [autoNext, chooseAutoNext] = useAutoNext();
  /** Точка, для якої водій уже сказав «ще ні» на підказці прибуття. */
  const [dismissedArrival, setDismissedArrival] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        routeKey
          ? `/api/tablet/day?route=${encodeURIComponent(routeKey)}`
          : dayKey
            ? `/api/tablet/day?day=${encodeURIComponent(dayKey)}`
            : "/api/tablet/day"
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setData(json as DayResp);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити день");
    }
  }, [routeKey, dayKey]);

  /**
   * Чергу віддаємо ПЕРЕД завантаженням дня.
   *
   * Інакше сервер поверне день без щойно зроблених відміток, і вони «зникнуть»
   * з екрана — людина вирішить, що натиснула не туди, і тисне ще раз.
   */
  const loadWithQueue = useCallback(async () => {
    await flushPendingVisits().catch(() => {});
    setQueued(listPendingVisits().map((v) => v.stopKey));
    await load();
  }, [load]);

  useEffect(() => {
    void loadWithQueue();
  }, [loadWithQueue]);

  /**
   * Повернення мережі — найкращий момент дожати чергу: браузер каже про це
   * сам, і чекати наступного оновлення сторінки не треба.
   */
  useEffect(() => {
    const onOnline = () => void loadWithQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [loadWithQueue]);

  const badge = TRACK_BADGE[track.status] ?? TRACK_BADGE.idle;
  const today = kyivToday();
  /**
   * Відкритий день не сьогоднішній — відмітки лише читаються.
   *
   * Не формальність: кнопка «Приїхав» пише візит у ту добу, яка відкрита
   * на екрані. Водій, що зайшов подивитися вчорашній лист і забув
   * повернутися, відмічав би сьогоднішні доставки вчорашнім числом — і
   * помітили б це аж на розрахунку. Виправити минуле може офіс, як і в
   * історії маршрутів.
   */
  const notToday = !!data && !!data.day && data.day !== today;
  /**
   * Відкрито лист колеги.
   *
   * Дивитися й будувати дорогу по ньому можна (заради цього листи всіх і
   * показуються), а відмічати — ні: візит належить тому, хто його поставив,
   * і дві відмітки одного клієнта від двох водіїв розсипали б і прогрес
   * маршруту, і зарплату. Сервер це теж не приймає (/api/visits), тут —
   * щоб людина не тиснула кнопку, яка однаково відмовить.
   */
  const foreign = !!data && data.route.source !== "NONE" && data.route.mine === false;
  const readOnly = notToday || foreign;
  // useMemo, а не ?? []: новий порожній масив на кожен рендер перезапускав
  // би розрахунок посилань нижче.
  const stops = useMemo(() => data?.route.stops ?? [], [data?.route.stops]);

  /**
   * Дорога в Google Maps: від того місця, де водій зараз, через ще не
   * відмічені точки. Відмічені навмисно пропускаємо — везти водія туди,
   * де він уже був, немає сенсу.
   *
   * Стартову точку НЕ задаємо взагалі — тоді Google сам підставляє «Ваше
   * місцезнаходження». Раніше сюди клали координату з веб-рекордера, і
   * виходило гірше в обидва боки: у застосунку рекордер вимкнений
   * (useTrackRecorder({ enabled: !isApp })), позиції немає — і маршрут
   * починався з ПЕРШОЇ ТОЧКИ, тобто Google рахував, ніби водій уже там; а
   * в браузері підставлялася координата, зафіксована колись раніше,
   * замість живої. Те саме правило вже діє в посиланні, яке логіст шле в
   * месенджер (lib/routes/driver-message.ts).
   */
  const mapLinks = useMemo(() => {
    const pending = stops
      .filter((s) => !s.visit && !queued.includes(s.key) && s.lat != null && s.lng != null)
      .map((s) => ({ lat: s.lat as number, lng: s.lng as number }));

    return googleMapsLinksFromHere(pending);
  }, [stops, queued]);

  /**
   * Наступна точка — та, куди водій їде ЗАРАЗ.
   *
   * Перша невідмічена за порядком обʼїзду. Саме вона й замінила «дорогу
   * частинами»: коли ведеш по одній точці, ліміт Google ні до чого
   * прикласти, а наступну підставляє застосунок, щойно попередню відмічено.
   */
  /**
   * Найближчі невідмічені точки за порядком обʼїзду.
   *
   * Не одна: водій сам обирає, скільки зарядити в навігатор — одну, три
   * чи пʼять. Одна це «веди мене туди», пʼять — погляд на найближчу
   * годину: видно, в який бік день і чи не доведеться вертатися.
   */
  const pending = useMemo(
    () => stops.filter((s) => !s.visit && !queued.includes(s.key) && s.lat != null && s.lng != null),
    [stops, queued]
  );

  /**
   * Водій уже на місці — питаємо, чи відмічати.
   *
   * Точка, до якої він їде, і його жива координата вже є на екрані; без
   * цієї підказки він мусить сам знайти потрібний рядок у списку з
   * тридцяти й розгорнути його — стоячи біля магазину, часто під дощем.
   *
   * Пін «до міста» сюди не пускаємо: у такого клієнта координата — центр
   * села, і сто п'ятдесят метрів від неї не значать нічого. Краще мовчати,
   * ніж питати «ви на місці?» за кілометр від воріт.
   */
  const arrival = useMemo(() => {
    if (readOnly || !track.position) return null;
    const head = pending[0];
    if (!head || head.key === dismissedArrival) return null;
    if (head.kind === "DELIVERY" && !head.counterpartyId) return null;
    if (head.geoSource === "CITY") return null;
    const m = haversineM(
      track.position.lat,
      track.position.lng,
      head.lat as number,
      head.lng as number
    );
    return m <= ARRIVE_M ? head : null;
  }, [readOnly, track.position, pending, dismissedArrival]);

  const mark = useCallback(
    async (
      stop: DayStop,
      status: "DONE" | "MISSED",
      money_: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE",
      extra?: { collectedAmount?: number; comment?: string }
    ) => {
      // Бонусна поїздка не має клієнта, а візит без клієнта неможливий
      // (@@unique [userId, day, counterpartyId]) — для неї станом служить
      // сам DeliveryStop.
      const isErrandStop = stop.kind !== "DELIVERY";
      /**
       * Точка доставки без клієнта — це не помилка водія, а недороблений
       * маршрут: візит без контрагента неможливий (@@unique за ним).
       * Раніше кнопка тут просто нічого не робила, і людина тиснула її знову й
       * знову, вважаючи, що зламався планшет.
       */
      if (!isErrandStop && !stop.counterpartyId) {
        setError(
          `«${stop.name}» не прив'язана до клієнта — відмітити не вийде. Скажіть логісту, він допише її в маршрут.`
        );
        return;
      }

      const url = isErrandStop
        ? `/api/erp/delivery-routes/stop/${stop.key.slice(3)}/mark`
        : "/api/visits";
      const body = isErrandStop
        ? { status: status === "DONE" ? "DELIVERED" : "FAILED", comment: extra?.comment }
        : {
            counterpartyId: stop.counterpartyId,
            status,
            money: money_,
            debtAmount: stop.debtAmount,
            collectedAmount: extra?.collectedAmount,
            comment: extra?.comment,
            routeSheetStopId: stop.key.startsWith("rs:") ? stop.key.slice(3) : null,
            deliveryStopId: stop.key.startsWith("ds:") ? stop.key.slice(3) : null,
            // Де стоїть планшет у мить відмітки — доказ присутності
            lat: track.position?.lat ?? null,
            lng: track.position?.lng ?? null,
          };

      /**
       * Спершу в чергу, потім спроба надіслати.
       *
       * Такий порядок означає, що відмітка не губиться навіть тоді, коли
       * сторінку закриють одразу після натискання або зв'язок обірветься
       * посеред запиту. Те саме правило, що в застосунку.
       */
      queueVisit({
        stopKey: stop.key,
        kind: isErrandStop ? "errand" : "visit",
        url,
        body,
        label: stop.name,
        createdAt: Date.now(),
      });
      setQueued(listPendingVisits().map((v) => v.stopKey));
      setOpenStop(null);
      setError(null);

      /**
       * Відмітив — і навігатор веде далі сам.
       *
       * Це і є відповідь на ліміт Google: наступну точку підставляємо ми, а
       * не посилання. Відкриваємо СИНХРОННО, до першого await, — інакше
       * браузер розірве звʼязок із дотиком по кнопці й порахує вікно
       * спливним. У застосунку не робимо: там цей екран нативний, і вікно
       * відкриває він.
       *
       * Порядок точок беремо той самий, що на екрані, мінус щойно
       * відмічена: водій міг закрити не першу, і вести його треба туди, куди
       * він і збирався.
       */
      if (autoNext && !readOnly && !isApp) {
        const take = navApp === "waze" ? 1 : batch;
        const next = pending
          .filter((s) => s.key !== stop.key)
          .slice(0, take)
          .map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
        const url = batchNavigateUrl(next, navApp);
        if (url) window.open(url, "_blank", "noopener");
      }

      setSaving(stop.key);
      try {
        await flushPendingVisits();
        setQueued(listPendingVisits().map((v) => v.stopKey));
        await load();
      } catch {
        // Не помилка: відмітка вже в черзі й піде, щойно з'явиться мережа.
      } finally {
        setSaving(null);
      }
    },
    [load, track.position, autoNext, readOnly, isApp, navApp, batch, pending]
  );



  return (
    <div style={{ background: "#F3F4F6", minHeight: "100vh" }}>
      {/* Шапка: маршрут, прогрес, стан треку.
          Цифри великі — на них дивляться скоса, тримаючи кермо. */}
      <header
        className="sticky top-0 z-20"
        style={{
          background: "#0A0A0A",
          color: "#fff",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="flex items-center gap-3 px-4" style={{ height: "56px" }}>
          {/*
            Заголовок став кнопкою вибору: досі він писав «Маршрут на
            сьогодні» і нічого, крім сьогодні, відкрити не давав. Тепер
            водій тапає по ньому і бере будь-який свій лист — учорашній,
            щоб звірити відмітки, або переданий на завтра.
          */}
          <RouteChip
            dark
            title={
              data?.route.number
                ? `Маршрут ${data.route.number}`
                : data
                  ? "Маршруту немає"
                  : "Завантаження…"
            }
            subtitle={
              data && data.progress.total > 0
                ? // Ім'я власника — першим: чужий лист має відрізнятися ще
                  // до того, як водій дочитав рядок до кінця.
                  (foreign ? `${data.route.driverName ?? "інший водій"} · ` : "") +
                  `${formatRouteDay(data.day, today)} · ${data.progress.done + data.progress.missed} з ${data.progress.total} точок` +
                  // Гроші чужого листа не показуємо взагалі: на екрані
                  // водія будь-яка сума читається як «моя каса».
                  (!foreign && data.progress.debtPlanned > 0
                    ? ` · ${formatPrice(data.progress.collected)} / ${formatPrice(data.progress.debtPlanned)}`
                    : "")
                : data
                  ? "Оберіть маршрутний лист"
                  : null
            }
            onClick={() => setPickerOpen(true)}
          />

          <div className="flex shrink-0 items-center gap-3 text-right">
            <div>
              <p style={{ fontSize: "17px", fontWeight: 700, lineHeight: 1.1 }}>
                {track.distanceKm || data?.track.distanceKm || 0}
                <span style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: 400 }}> км</span>
              </p>
              <p
                className="flex items-center justify-end gap-1.5"
                style={{ fontSize: "11px", color: "#D1D5DB", lineHeight: 1.3 }}
              >
                <span
                  aria-hidden
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: isApp ? "#16A34A" : badge.dot,
                    display: "inline-block",
                  }}
                />
                {/* У застосунку трек веде служба, а не ця вкладка —
                    показувати її стан було б брехнею. */}
                {isApp ? "Трек іде" : badge.label}
                {!isApp && track.pending > 0 && (
                  <span style={{ color: "#FB923C" }}>+{track.pending}</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Смужка прогресу: єдиний елемент, який читається боковим зором */}
        {data && data.progress.total > 0 && (
          <div
            role="progressbar"
            aria-valuenow={data.progress.done + data.progress.missed}
            aria-valuemin={0}
            aria-valuemax={data.progress.total}
            aria-label="Пройдено точок маршруту"
            style={{ height: "3px", background: "#1F2937", display: "flex" }}
          >
            <span
              style={{
                width: `${(data.progress.done / data.progress.total) * 100}%`,
                background: "#16A34A",
                transition: "width .3s",
              }}
            />
            <span
              style={{
                width: `${(data.progress.missed / data.progress.total) * 100}%`,
                background: "#DC2626",
                transition: "width .3s",
              }}
            />
          </div>
        )}
      </header>

      {/* Вийшов деплой під відкритою вкладкою: стара сторінка не може
          довантажити свої чанки, і кнопки тихо перестають працювати.
          Пропонуємо оновитись, але не робимо це самі — щоб не стерти
          недописану відмітку візиту. */}
      {build.stale && (
        <button
          type="button"
          onClick={build.reload}
          className="cursor-pointer transition-colors duration-200"
          style={{
            width: "100%",
            minHeight: "44px",
            border: "none",
            background: "#FFD600",
            color: "#0A0A0A",
            fontSize: "14px",
            fontWeight: 700,
          }}
        >
          Вийшло оновлення — натисніть, щоб перезавантажити
        </button>
      )}

      {/*
        Смуга дня, який не сьогодні. Стоїть під шапкою, а не всередині
        списку: водій має побачити її раніше, ніж дотягнеться пальцем до
        першої точки.
      */}
      {/*
        Чужий лист. Жовтим, а не синім: синє тут уже означає «минулий
        день», і два різні обмеження одним кольором не читаються.
      */}
      {foreign && (
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ background: "#FFFBEB", borderBottom: "1px solid #FDE68A" }}
        >
          <p className="min-w-0 flex-1" style={{ fontSize: "13px", color: "#92400E", lineHeight: 1.4 }}>
            <span style={{ fontWeight: 700 }}>Лист {data!.route.driverName ?? "іншого водія"}</span>{" "}
            — переглянути й побудувати дорогу можна, відмічати точки й здавати касу може лише він.
          </p>
          <button
            type="button"
            onClick={() => router.replace("/driver/tablet")}
            className="shrink-0 cursor-pointer rounded-lg"
            style={{
              minHeight: "36px",
              padding: "0 12px",
              border: "none",
              background: "#0A0A0A",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            До свого
          </button>
        </div>
      )}

      {notToday && (
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ background: "#EFF6FF", borderBottom: "1px solid #BFDBFE" }}
        >
          <p className="min-w-0 flex-1" style={{ fontSize: "13px", color: "#1D4ED8", lineHeight: 1.4 }}>
            <span style={{ fontWeight: 700 }}>{formatRouteDay(data!.day, today)}</span> — лише
            перегляд. Відмітити можна тільки поточний день; минуле виправляє офіс.
          </p>
          <button
            type="button"
            onClick={() => router.replace("/driver/tablet")}
            className="shrink-0 cursor-pointer rounded-lg"
            style={{
              minHeight: "36px",
              padding: "0 12px",
              border: "none",
              background: "#2563EB",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            До сьогодні
          </button>
        </div>
      )}

      {queued.length > 0 && (
        <div className="px-4 py-2.5" style={{ background: "#FEF3C7", borderBottom: "1px solid #FDE68A" }}>
          <p style={{ fontSize: "13.5px", fontWeight: 600, color: "#92400E" }}>
            Чекає на мережу: {queued.length}
          </p>
          <p style={{ fontSize: "12.5px", color: "#92400E", marginTop: "2px" }}>
            Відмітки збережено на планшеті. Надішлемо самі — тикати ще раз не треба.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: "#DC2626" }}>
          <p className="flex-1" style={{ fontSize: "13.5px", fontWeight: 600, color: "#fff" }}>
            {error}
          </p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Закрити помилку"
            className="shrink-0 cursor-pointer rounded-lg"
            style={{
              minWidth: "44px",
              minHeight: "36px",
              border: "none",
              background: "rgba(255,255,255,0.2)",
              color: "#fff",
              fontSize: "15px",
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {!data ? (
        <p className="px-4 py-6" style={{ color: "#9CA3AF", fontSize: "14px" }}>
          Завантаження…
        </p>
      ) : stops.length === 0 ? (
        <div className="px-4 py-6">
          <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}>
            {routeKey
              ? "У цьому листі немає точок"
              : dayKey
                ? "Того дня маршруту не було"
                : "Маршрут на сьогодні ще не передано"}
          </p>
          <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "6px", lineHeight: 1.5 }}>
            {routeKey
              ? "Схоже, лист уже прибрали або точки з нього перенесли в інший маршрут. Оберіть інший лист угорі."
              : dayKey
                ? "Ні маршруту сайту, ні листа 1С на цю дату немає. Оберіть інший лист угорі."
                : "Логіст ще складає список. Точки зʼявляться, щойно маршрут передадуть вам — трек тим часом усе одно записується."}
          </p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="mt-3 cursor-pointer rounded-xl"
            style={{
              minHeight: "44px",
              padding: "0 16px",
              border: "1px solid #E5E7EB",
              background: "#fff",
              color: "#0A0A0A",
              fontSize: "14px",
              fontWeight: 700,
            }}
          >
            Обрати маршрутний лист
          </button>
        </div>
      ) : (
        <>
          {/*
            Картка маршруту показується в БУДЬ-ЯКИЙ день, а не лише сьогодні.
            Спершу її ховав той самий прапорець, що й кнопки відміток, — і
            вийшло, що водій, відкривши вчорашній чи завтрашній лист, не міг
            навіть побудувати дорогу. Але «відмітити» і «поїхати» — різні
            дії: перша пише візит у відкриту добу й тому лишається тільки за
            поточним днем, друга не міняє нічого взагалі.
          */}
          {/* Водій уже на місці — відмітка одним дотиком, не шукаючи рядок */}
          {arrival && (
            <ArrivalCard
              stop={arrival}
              saving={saving === arrival.key}
              onMark={mark}
              onDismiss={() => setDismissedArrival(arrival.key)}
            />
          )}

          {pending.length > 0 && (
            <NextStopCard
              stops={pending}
              left={data.progress.left}
              routeId={data.route.id}
              navApp={navApp}
              onChooseNav={chooseNav}
              batch={batch}
              onChooseBatch={chooseBatch}
              autoNext={autoNext}
              onChooseAutoNext={chooseAutoNext}
              readOnly={readOnly}
              myOrder={!!data.route.myOrder}
              wholeRoute={mapLinks}
            />
          )}


          <div style={{ background: "#fff", marginTop: "8px" }}>
            {stops.map((s) => (
              <StopRow
                key={s.key}
                stop={s}
                open={openStop === s.key}
                saving={saving === s.key}
                pending={queued.includes(s.key)}
                readOnly={readOnly}
                routeId={data.route.id}
                navApp={navApp}
                onToggle={() => setOpenStop(openStop === s.key ? null : s.key)}
                onMark={mark}
              />
            ))}
          </div>

          {/* Каса — лише на своєму листі: під чужим маршрутом вона
              показувала б мої гроші як гроші того дня, і водій здав би не
              ту суму. */}
          {!foreign && (
            <CashPanel
              cash={data.cash}
              day={data.day}
              readOnly={notToday}
              onSaved={load}
              onError={setError}
            />
          )}
        </>
      )}

      {pickerOpen && (
        <RouteSheet
          current={routeKey}
          onPick={(key) =>
            router.replace(key ? `/driver/tablet?route=${encodeURIComponent(key)}` : "/driver/tablet")
          }
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Дві дії з точкою, і вони різні за суттю.
 *
 * «На карті» лишається В НАШОМУ застосунку: відкриває наш екран маршруту й
 * стає просто на цю точку. Досі тут була одна кнопка — «Відкрити в Google
 * Maps», — і водій, якому треба було лише глянути, де це, щоразу вилітав у
 * чужу програму й повертався назад кнопкою «назад».
 *
 * «Їхати» так і віддає навігатору: вести машину посилання не вміє, це
 * робота Google Maps або Waze.
 */
function StopMapButtons({
  stop,
  routeId,
  navApp,
}: {
  stop: DayStop;
  routeId: string | null;
  navApp: NavApp;
}) {
  return (
    <div className="mt-2 flex gap-2">
      <Link
        href={
          `/driver/map?focus=${encodeURIComponent(stop.key)}` +
          (routeId ? `&route=${encodeURIComponent(routeId)}` : "")
        }
        className="flex-1 cursor-pointer"
        style={{
          display: "block",
          padding: "12px",
          borderRadius: "10px",
          border: "1px solid #E5E7EB",
          background: "#fff",
          color: "#0A0A0A",
          textAlign: "center",
          fontSize: "14px",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        На карті
      </Link>
      <a
        href={navigateUrl({ lat: stop.lat as number, lng: stop.lng as number }, navApp)}
        target="_blank"
        rel="noopener"
        className="flex-1 cursor-pointer transition-colors duration-200"
        style={{
          display: "block",
          padding: "12px",
          borderRadius: "10px",
          background: "#2563EB",
          color: "#fff",
          textAlign: "center",
          fontSize: "14px",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        Їхати
      </a>
    </div>
  );
}

/**
 * Куди їхати просто зараз — і на скільки точок наперед.
 *
 * Замінила «дорогу частинами». Та була наслідком чужого обмеження:
 * посилання Google бере щонайбільше девʼять проміжних точок, тож день на
 * 25 адрес різався на три шматки, і між ними водій мусив САМ згадати, що
 * треба повернутися в кабінет і відкрити наступний. За кермом про це не
 * згадують — відкривали перший шматок і далі їхали навмання.
 *
 * Тепер розмір пачки обирає водій: одна точка, три або пʼять. Одна — це
 * «веди мене туди», пʼять — погляд на найближчу годину, з якого видно, в
 * який бік день. Що б він не обрав, наступну пачку підставляє застосунок,
 * коли попередні відмічено, — ліміту як проблеми більше немає.
 *
 * Waze приймає рівно одну точку, тому з ним вибір пачки не показуємо: це
 * не наша вада й не його, просто інший інструмент.
 */
function NextStopCard({
  stops,
  left,
  routeId,
  navApp,
  onChooseNav,
  batch,
  onChooseBatch,
  autoNext,
  onChooseAutoNext,
  readOnly,
  myOrder,
  wholeRoute,
}: {
  /** Невідмічені точки за порядком обʼїзду, перша — найближча */
  stops: DayStop[];
  /** Скільки точок ще не відмічено, разом із цими */
  left: number;
  /** Ключ листа — щоб огляд відкрив саме цей день, а не сьогоднішній */
  routeId: string | null;
  navApp: NavApp;
  onChooseNav: (app: NavApp) => void;
  batch: NavBatch;
  onChooseBatch: (n: NavBatch) => void;
  /** Після відмітки навігатор веде далі сам */
  autoNext: boolean;
  onChooseAutoNext: (on: boolean) => void;
  /** Минулий, завтрашній або чужий лист: їхати можна, відмічати — ні. */
  readOnly: boolean;
  /** Точки йдуть у порядку, який водій склав собі на карті */
  myOrder: boolean;
  wholeRoute: Array<{ url: string; points: number }>;
}) {
  const [showWhole, setShowWhole] = useState(false);

  // Waze веде до однієї точки — пачка для нього завжди одна.
  const take = navApp === "waze" ? 1 : batch;
  const chunk = stops.slice(0, take);

  const url = batchNavigateUrl(
    chunk.map((s) => ({ lat: s.lat as number, lng: s.lng as number })),
    navApp
  );

  return (
    <section className="px-4 py-3" style={{ background: "#fff" }}>
      <div className="flex items-center gap-2">
        <p
          style={{
            fontSize: "12px",
            fontWeight: 700,
            color: "#6B7280",
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          {chunk.length > 1 ? "Наступні точки" : "Наступна точка"}
        </p>
        <span style={{ fontSize: "12px", color: "#9CA3AF" }}>
          {/* Скільки лишиться ПІСЛЯ цієї пачки: «ще 32 точки», коли попереду
              рівно 32 разом із поточними, читається як помилка в рахунку. */}
          {left > chunk.length ? `далі ще ${pointsLabel(left - chunk.length)}` : "останні"}
        </span>
        {/* Номери в списку тепер не збігаються з папером — треба сказати
            чому, інакше це виглядає як збій. */}
        {myOrder && (
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#D97706" }}>ваш порядок</span>
        )}

        {/* Вибір навігатора — тут, а не в налаштуваннях: його міняють раз у
            житті, але саме в ту мить, коли вперше тиснуть «Їхати». */}
        <div className="ml-auto flex gap-1 rounded-full p-0.5" style={{ background: "#F3F4F6" }}>
          {(["google", "waze"] as NavApp[]).map((app) => (
            <button
              key={app}
              type="button"
              onClick={() => onChooseNav(app)}
              aria-pressed={navApp === app}
              className="cursor-pointer rounded-full transition-colors duration-200"
              style={{
                minHeight: "32px",
                padding: "0 12px",
                border: "none",
                background: navApp === app ? "#0A0A0A" : "transparent",
                color: navApp === app ? "#fff" : "#6B7280",
                fontSize: "12px",
                fontWeight: 700,
              }}
            >
              {app === "google" ? "Google" : "Waze"}
            </button>
          ))}
        </div>
      </div>

      {/* Скільки точок заряджаємо. Не показуємо, коли їх однаково менше
          двох: вибір «1 / 3 / 5» на останній точці дня — це кнопки, що
          нічого не міняють. */}
      {navApp === "google" && stops.length > 1 && (
        <div className="mt-2 flex items-center gap-2">
          <span style={{ fontSize: "12px", color: "#6B7280" }}>Скільки точок:</span>
          <div className="flex gap-1 rounded-full p-0.5" style={{ background: "#F3F4F6" }}>
            {NAV_BATCHES.filter((n) => n === 1 || n <= stops.length).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChooseBatch(n)}
                aria-pressed={batch === n}
                className="cursor-pointer rounded-full transition-colors duration-200"
                style={{
                  minWidth: "40px",
                  minHeight: "32px",
                  border: "none",
                  background: batch === n ? "#0A0A0A" : "transparent",
                  color: batch === n ? "#fff" : "#6B7280",
                  fontSize: "13px",
                  fontWeight: 700,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/*
        Автоперехід — тут, а не в налаштуваннях: він міняє те, що станеться
        одразу після наступної відмітки, і рішення про нього приймають саме
        в цю мить. У читальному режимі не показуємо: відміток там немає, а
        отже й переходити нема від чого.
      */}
      {!readOnly && (
        <button
          type="button"
          role="switch"
          aria-checked={autoNext}
          onClick={() => onChooseAutoNext(!autoNext)}
          className="mt-2 flex w-full cursor-pointer items-center gap-2"
          style={{
            minHeight: "36px",
            padding: 0,
            border: "none",
            background: "none",
            textAlign: "left",
          }}
        >
          <span
            aria-hidden
            className="flex shrink-0 items-center justify-center"
            style={{
              width: "20px",
              height: "20px",
              borderRadius: "6px",
              border: autoNext ? "none" : "1.5px solid #D1D5DB",
              background: autoNext ? "#0A0A0A" : "#fff",
              color: "#FFD600",
              fontSize: "12px",
              fontWeight: 800,
            }}
          >
            {autoNext ? "✓" : ""}
          </span>
          <span style={{ fontSize: "13px", color: autoNext ? "#0A0A0A" : "#6B7280" }}>
            Після відмітки — одразу вести далі
          </span>
        </button>
      )}

      {/* Що саме поїде в навігатор. Головна відмінність від «однієї точки»:
          водій бачить пачку списком ДО того, як відкрив Google, і встигає
          зрозуміти, що маршрут веде не в той бік. */}
      <ol className="mt-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {chunk.map((s, i) => (
          <li key={s.key} className="flex items-baseline gap-2" style={{ marginTop: i ? "6px" : 0 }}>
            <span
              className="flex shrink-0 items-center justify-center"
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "7px",
                background: i === 0 ? "#0A0A0A" : "#F3F4F6",
                color: i === 0 ? "#FFD600" : "#6B7280",
                fontSize: "12px",
                fontWeight: 800,
              }}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block truncate"
                style={{
                  fontSize: i === 0 ? "17px" : "14px",
                  fontWeight: i === 0 ? 700 : 600,
                  color: "#0A0A0A",
                }}
              >
                {s.kind !== "DELIVERY" && (
                  <span style={{ marginRight: "5px" }}>{s.kind === "PICKUP" ? "↩️" : "✳️"}</span>
                )}
                {s.name}
              </span>
              {!!s.address && (
                <span
                  className="block truncate"
                  style={{ fontSize: i === 0 ? "13px" : "12px", color: "#6B7280" }}
                >
                  {s.address}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      <a
        href={url}
        target="_blank"
        rel="noopener"
        className="cursor-pointer transition-colors duration-200"
        style={{
          display: "block",
          marginTop: "10px",
          padding: "16px",
          borderRadius: "12px",
          background: "#2563EB",
          color: "#fff",
          fontSize: "16px",
          fontWeight: 700,
          textAlign: "center",
          textDecoration: "none",
        }}
      >
        {chunk.length > 1
          ? `Їхати · ${pointsLabel(chunk.length)}`
          : `Їхати в ${navApp === "waze" ? "Waze" : "Google Maps"}`}
      </a>

      {/* Огляд усього дня — поруч із «їхати», а не десь нижче списком.
          Новому водієві він потрібен ПЕРЕД виїздом: побачити, де точки, у
          якому вони порядку і скільки це кілометрів. Досвідчений просто
          його не тисне. */}
      {!!routeId && (
        <Link
          href={`/driver/map?route=${encodeURIComponent(routeId)}`}
          className="cursor-pointer"
          style={{
            display: "block",
            marginTop: "8px",
            padding: "13px",
            borderRadius: "12px",
            border: "1px solid #E5E7EB",
            background: "#fff",
            color: "#0A0A0A",
            fontSize: "14px",
            fontWeight: 700,
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Весь маршрут на карті
        </Link>
      )}

      <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "8px", lineHeight: 1.5 }}>
        {readOnly
          ? "Дорога почнеться там, де ви зараз. Відмітити точки цього дня не вийде — це робить офіс."
          : navApp === "waze"
            ? "Waze веде до однієї точки за раз. Дорога почнеться там, де ви зараз."
            : "Дорога почнеться там, де ви зараз. Відмітили точки — тут зʼявляться наступні."}
      </p>

      {wholeRoute.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowWhole((v) => !v)}
            className="cursor-pointer"
            style={{
              marginTop: "4px",
              padding: "6px 0",
              border: "none",
              background: "none",
              color: "#6B7280",
              fontSize: "12px",
              textDecoration: "underline",
            }}
          >
            {showWhole ? "Сховати" : "Завантажити весь маршрут частинами"}
          </button>

          {showWhole && (
            <div className="flex flex-wrap gap-2">
              {wholeRoute.map((link, idx) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener"
                  className="cursor-pointer"
                  style={{
                    flex: wholeRoute.length === 1 ? "1 1 100%" : "1 1 45%",
                    padding: "11px 12px",
                    borderRadius: "10px",
                    background: "#EFF6FF",
                    color: "#1D4ED8",
                    fontSize: "13px",
                    fontWeight: 700,
                    textAlign: "center",
                    textDecoration: "none",
                  }}
                >
                  {wholeRoute.length === 1
                    ? `Весь маршрут · ${pointsLabel(link.points)}`
                    : `Частина ${idx + 1} · ${pointsLabel(link.points)}`}
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Каса за день: скільки зібрав, скільки везе, кнопка здачі.
 *
 * Стоїть у кінці списку навмисно — це останнє, що водій робить за день,
 * прокрутивши всі точки.
 */
function CashPanel({
  cash,
  day,
  readOnly,
  onSaved,
  onError,
}: {
  cash: DayResp["cash"];
  day: string;
  /** Минулий день: числа видно, а здавати й скасовувати вже не можна. */
  readOnly: boolean;
  onSaved: () => Promise<void> | void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const startHandover = () => {
    // Підставляємо те, що на руках: у більшості днів водій просто
    // підтверджує цифру, не набираючи її пальцем у машині.
    setAmount(String(Math.max(0, Math.round(cash.onHands * 100) / 100)));
    setComment("");
    setOpen(true);
  };

  const submit = async () => {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      onError("Вкажіть суму, яку здаєте");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/driver/cash-handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value, day, comment: comment || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти здачу");
      setOpen(false);
      onError(null);
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не вдалося зберегти здачу");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/driver/cash-handover?id=${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося скасувати");
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не вдалося скасувати здачу");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="px-4 py-4"
      style={{ background: "#fff", marginTop: "8px" }}
    >
      <p
        style={{
          fontSize: "12px",
          fontWeight: 700,
          color: "#6B7280",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {readOnly ? "Каса за той день" : "Каса за сьогодні"}
      </p>

      <div className="mt-2 flex items-baseline gap-3">
        <span style={{ fontSize: "13px", color: "#374151" }}>
          Зібрано {formatPrice(cash.collected)}
        </span>
        {cash.handed > 0 && (
          <span style={{ fontSize: "13px", color: "#6B7280" }}>
            здано {formatPrice(cash.handed)}
          </span>
        )}
      </div>

      <p style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A", marginTop: "2px" }}>
        На руках: {formatPrice(cash.onHands)}
      </p>

      {cash.handovers.length > 0 && (
        <ul className="mt-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {cash.handovers.map((h) => (
            <li
              key={h.id}
              className="flex items-center gap-2"
              style={{ padding: "8px 0", borderTop: "1px solid #F3F4F6" }}
            >
              <span className="min-w-0 flex-1">
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
                  {formatPrice(h.amount)}
                </span>
                <span style={{ fontSize: "12px", color: "#6B7280", marginLeft: "8px" }}>
                  о{" "}
                  {new Date(h.handedAt).toLocaleTimeString("uk-UA", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span
                  className="block"
                  style={{
                    fontSize: "12px",
                    marginTop: "1px",
                    color: h.confirmedAt ? "#16A34A" : "#D97706",
                    fontWeight: 600,
                  }}
                >
                  {h.confirmedAt
                    ? `Прийнято${
                        h.confirmedAmount != null && h.confirmedAmount !== h.amount
                          ? ` ${formatPrice(h.confirmedAmount)}`
                          : ""
                      }`
                    : "Очікує підтвердження офісу"}
                </span>
              </span>
              {/* Скасувати можна лише непідтверджену: після прийому це вже
                  документ про гроші, і прибирати його водієві не можна. */}
              {!h.confirmedAt && !readOnly && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void cancel(h.id)}
                  className="shrink-0 cursor-pointer rounded-lg"
                  style={{
                    minHeight: "40px",
                    padding: "0 12px",
                    border: "1px solid #E5E7EB",
                    background: "#fff",
                    color: "#6B7280",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  Скасувати
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {readOnly ? null : !open ? (
        <button
          type="button"
          disabled={cash.onHands <= 0}
          onClick={startHandover}
          className="w-full cursor-pointer transition-colors duration-200 disabled:cursor-default"
          style={{
            marginTop: "12px",
            padding: "15px",
            borderRadius: "12px",
            border: "none",
            background: cash.onHands > 0 ? "#0A0A0A" : "#F3F4F6",
            color: cash.onHands > 0 ? "#fff" : "#9CA3AF",
            fontSize: "15px",
            fontWeight: 700,
          }}
        >
          {cash.onHands > 0
            ? `Здаю касу ${formatPrice(cash.onHands)}`
            : cash.handed > 0
              ? "Усе здано"
              : "Поки нема чого здавати"}
        </button>
      ) : (
        <div className="mt-3">
          <label
            htmlFor="cash-amount"
            style={{ fontSize: "13px", color: "#374151", fontWeight: 600 }}
          >
            Скільки здаєте, ₴
          </label>
          <input
            id="cash-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            style={{
              width: "100%",
              marginTop: "6px",
              padding: "13px",
              borderRadius: "10px",
              border: "1px solid #E5E7EB",
              fontSize: "18px",
              fontWeight: 700,
              textAlign: "center",
            }}
          />
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Коментар: решта, розмін…"
            style={{
              width: "100%",
              marginTop: "8px",
              padding: "11px",
              borderRadius: "10px",
              border: "1px solid #E5E7EB",
              fontSize: "14px",
            }}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setOpen(false)}
              className="cursor-pointer"
              style={{
                flex: 1,
                padding: "13px",
                borderRadius: "10px",
                border: "1px solid #E5E7EB",
                background: "#fff",
                color: "#374151",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="cursor-pointer"
              style={{
                flex: 2,
                padding: "13px",
                borderRadius: "10px",
                border: "none",
                background: "#16A34A",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 700,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Зберігаю…" : "Підтверджую здачу"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * «Ви на місці. Приїхали?» — відмітка, коли водій уже вийшов з машини.
 *
 * Без неї шлях такий: вилізти з кабіни, розблокувати планшет, знайти
 * потрібний рядок серед тридцяти, розгорнути, натиснути. Кожен крок — під
 * дощем і з коробкою в руках, і саме тому відмітки часто ставили ввечері
 * пачкою, коли вже нічого не памʼятаєш.
 *
 * Кнопки ті самі, що в рядку, і сенс той самий: «забрав» ставить борг
 * точки повністю, «просто приїхав» — нуль. Часткову суму тут не питаємо:
 * для неї є рядок, а підказка мусить закриватися одним дотиком.
 *
 * «Ще ні» ховає її до наступної точки: буває, що водій під'їхав і чекає
 * розвантаження півгодини, і питати його весь цей час не можна.
 */
function ArrivalCard({
  stop,
  saving,
  onMark,
  onDismiss,
}: {
  stop: DayStop;
  saving: boolean;
  onMark: (
    stop: DayStop,
    status: "DONE" | "MISSED",
    money: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE",
    extra?: { collectedAmount?: number; comment?: string }
  ) => void;
  onDismiss: () => void;
}) {
  const isErrand = stop.kind !== "DELIVERY";
  const hasDebt = !isErrand && stop.debtAmount > 0;

  const btn = (bg: string, color: string) =>
    ({
      flex: "1 1 0",
      minHeight: "48px",
      padding: "0 12px",
      borderRadius: "12px",
      border: "none",
      background: bg,
      color,
      fontSize: "14px",
      fontWeight: 700,
    }) as const;

  return (
    <section
      className="px-4 py-3"
      style={{ background: "#F0FDF4", borderBottom: "1px solid #BBF7D0" }}
    >
      <p style={{ fontSize: "12px", fontWeight: 700, color: "#15803D", letterSpacing: "0.03em" }}>
        ВИ НА МІСЦІ
      </p>
      <p
        className="truncate"
        style={{ fontSize: "17px", fontWeight: 700, color: "#0A0A0A", marginTop: "2px" }}
      >
        {stop.name}
      </p>
      {!!stop.address && (
        <p className="truncate" style={{ fontSize: "13px", color: "#6B7280" }}>
          {stop.address}
        </p>
      )}

      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => onMark(stop, "DONE", hasDebt ? "FULL" : "NONE")}
          className="cursor-pointer"
          style={btn("#16A34A", "#fff")}
        >
          {saving
            ? "Зберігаю…"
            : isErrand
              ? "Виконано"
              : hasDebt
                ? `Приїхав, забрав ${formatPrice(stop.debtAmount)}`
                : "Приїхав"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => onMark(stop, "MISSED", "NOT_APPLICABLE")}
          className="cursor-pointer"
          style={{ ...btn("#fff", "#DC2626"), flex: "0 0 auto", border: "1px solid #FECACA" }}
        >
          {isErrand ? "Не вийшло" : "Не потрапив"}
        </button>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="cursor-pointer"
        style={{
          marginTop: "6px",
          padding: "6px 0",
          border: "none",
          background: "none",
          color: "#6B7280",
          fontSize: "12.5px",
          textDecoration: "underline",
        }}
      >
        Ще ні — я тільки під&apos;їхав
      </button>
    </section>
  );
}

/** Рядок чек-ліста: згорнутий — статус, розгорнутий — кнопки й гроші. */
function StopRow({
  stop,
  open,
  saving,
  pending,
  readOnly,
  routeId,
  navApp,
  onToggle,
  onMark,
}: {
  stop: DayStop;
  open: boolean;
  saving: boolean;
  /** Відмітка збережена на пристрої, але ще не доїхала на сервер. */
  pending: boolean;
  /** Відкрито минулий день: точку видно, а відмітити її вже не можна. */
  readOnly: boolean;
  /** Ключ листа — щоб «на карті» відкрило саме цей день */
  routeId: string | null;
  navApp: NavApp;
  onToggle: () => void;
  onMark: (
    stop: DayStop,
    status: "DONE" | "MISSED",
    money: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE",
    extra?: { collectedAmount?: number; comment?: string }
  ) => void;
}) {
  const [partial, setPartial] = useState("");
  const [comment, setComment] = useState("");

  const done = stop.visit?.status === "DONE";
  const missed = stop.visit?.status === "MISSED";
  // У бонусній поїздці нічого не везуть і нічого не забирають грішми:
  // ховаємо суми й блок інкасації, лишаємо саму справу.
  const isErrand = stop.kind !== "DELIVERY";
  const hasDebt = !isErrand && stop.debtAmount > 0;

  return (
    <div
      style={{
        borderBottom: "1px solid #F3F4F6",
        background: done ? "#F0FDF4" : missed ? "#FEF2F2" : isErrand ? "#FFFDF5" : "#fff",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 text-left"
        style={{ background: "none", border: "none", padding: "12px 16px" }}
      >
        <span
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: "28px",
            height: "28px",
            background: done ? "#16A34A" : missed ? "#DC2626" : "#E5E7EB",
            color: done || missed ? "#fff" : "#374151",
            fontSize: "13px",
            fontWeight: 700,
          }}
        >
          {done ? "✓" : missed ? "×" : stop.sequence}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className="block truncate"
            style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}
          >
            {isErrand && (
              <span style={{ marginRight: "5px" }}>{stop.kind === "PICKUP" ? "↩️" : "✳️"}</span>
            )}
            {stop.name}
          </span>
          {stop.address && (
            <span
              className="block truncate"
              style={{ fontSize: "12px", color: "#6B7280", marginTop: "1px" }}
            >
              {stop.address}
            </span>
          )}
          {stop.notes && (
            <span
              className="block"
              style={{ fontSize: "12px", color: "#92400E", marginTop: "2px" }}
            >
              {stop.notes}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-2" style={{ marginTop: "3px" }}>
            {isErrand && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#92400E",
                  background: "#FEF3C7",
                  padding: "1px 6px",
                  borderRadius: "4px",
                }}
              >
                {stop.kind === "PICKUP" ? "ЗАБРАТИ" : "ДОРУЧЕННЯ"}
              </span>
            )}
            {!isErrand && stop.amount > 0 && (
              <span style={{ fontSize: "12px", color: "#374151" }}>
                {formatPrice(stop.amount)}
              </span>
            )}
            {hasDebt && (
              <span style={{ fontSize: "12px", color: "#DC2626", fontWeight: 600 }}>
                борг {formatPrice(stop.debtAmount)}
              </span>
            )}
            {stop.visit?.collectedAmount != null && stop.visit.collectedAmount > 0 && (
              <span style={{ fontSize: "12px", color: "#16A34A", fontWeight: 600 }}>
                забрано {formatPrice(stop.visit.collectedAmount)}
              </span>
            )}
            {stop.geoSource !== "MANUAL" && stop.lat != null && (
              <span style={{ fontSize: "11px", color: "#D97706" }}>точка приблизна</span>
            )}
          </span>
        </span>
      </button>

      {open && readOnly && (
        <div className="px-4 pb-4">
          <p style={{ fontSize: "13px", color: "#6B7280", lineHeight: 1.5 }}>
            {stop.visit?.comment
              ? `Ваш коментар того дня: «${stop.visit.comment}»`
              : done
                ? "Точку відмічено як пройдену."
                : missed
                  ? "Того дня в точку не потрапили."
                  : "Відмітки за цю точку немає."}
          </p>
          {stop.lat != null && stop.lng != null && (
            <StopMapButtons stop={stop} routeId={routeId} navApp={navApp} />
          )}
        </div>
      )}

      {open && !readOnly && (
        <div className="px-4 pb-4">
          {/* Головні дві кнопки — великі, поруч: приїхав / не потрапив */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                onMark(stop, "DONE", hasDebt ? "FULL" : "NOT_APPLICABLE", {
                  comment: comment || undefined,
                })
              }
              style={{
                flex: 1,
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: "#16A34A",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 700,
                opacity: saving ? 0.5 : 1,
              }}
            >
              {hasDebt
                ? `Приїхав, забрав ${formatPrice(stop.debtAmount)}`
                : isErrand
                  ? "Зробив"
                  : "Приїхав"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                onMark(stop, "MISSED", "NOT_APPLICABLE", { comment: comment || undefined })
              }
              style={{
                flex: 1,
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: "#DC2626",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 700,
                opacity: saving ? 0.5 : 1,
              }}
            >
              {isErrand ? "Не вийшло" : "Не потрапив"}
            </button>
          </div>

          {/* Гроші: тільки якщо є що забирати */}
          {hasDebt && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => onMark(stop, "DONE", "NONE", { comment: comment || undefined })}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: "10px",
                  border: "1px solid #E5E7EB",
                  background: "#fff",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Не забрав нічого
              </button>
              <input
                inputMode="decimal"
                value={partial}
                onChange={(e) => setPartial(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="Сума"
                aria-label="Часткова сума"
                style={{
                  width: "96px",
                  padding: "11px",
                  borderRadius: "10px",
                  border: "1px solid #E5E7EB",
                  fontSize: "15px",
                  textAlign: "center",
                }}
              />
              <button
                type="button"
                disabled={saving || !partial}
                onClick={() =>
                  onMark(stop, "DONE", "PARTIAL", {
                    collectedAmount: Number(partial.replace(",", ".")),
                    comment: comment || undefined,
                  })
                }
                style={{
                  padding: "11px 16px",
                  borderRadius: "10px",
                  border: "none",
                  background: partial ? "#0A0A0A" : "#E5E7EB",
                  color: partial ? "#fff" : "#9CA3AF",
                  fontSize: "14px",
                  fontWeight: 700,
                }}
              >
                ОК
              </button>
            </div>
          )}

          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Коментар: магазин закритий, немає грошей…"
            style={{
              width: "100%",
              marginTop: "8px",
              padding: "11px",
              borderRadius: "10px",
              border: "1px solid #E5E7EB",
              fontSize: "14px",
            }}
          />

          {pending ? (
            <p style={{ fontSize: "12px", color: "#B45309", marginTop: "8px" }}>
              Збережено на пристрої — надішлемо, щойно з’явиться мережа. Тиснути ще раз не треба.
            </p>
          ) : (
            stop.visit?.status && (
              <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "8px" }}>
                Відмічено. Натисніть іншу кнопку, щоб виправити.
              </p>
            )
          )}

          {stop.lat != null && stop.lng != null && (
            <StopMapButtons stop={stop} routeId={routeId} navApp={navApp} />
          )}
        </div>
      )}
    </div>
  );
}
