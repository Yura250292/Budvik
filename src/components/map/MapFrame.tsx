"use client";

/**
 * Спільна рамка для всіх карт адмінки.
 *
 * Правило одне на всі карти: карта стоїть у своєму блоці й НЕ перехоплює
 * скрол сторінки. Колесо гортає сторінку, поки користувач не клікне по
 * карті — тоді воно масштабує; курсор пішов за межі карти — колесо знову
 * віддається сторінці. Пан — лише перетягуванням, зум — кнопками +/− або
 * колесом після кліку.
 *
 * Це поведінка карти напрямків (RoutesOverviewMap), яку зробили еталоном;
 * тут вона винесена, щоб кожна карта не повторювала ті самі тридцять рядків
 * і не розходилася з рештою при наступній правці.
 */

import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import type L from "leaflet";

/** Опції L.map, спільні для всіх карт: зум кнопками, колесо — лише після кліку. */
export const FRAMED_MAP_OPTIONS = {
  zoomControl: true,
  attributionControl: true,
  scrollWheelZoom: false,
} as const;

/**
 * Робоча область — Україна.
 *
 * Приблизно державний кордон: 44.0–52.5 пн.ш., 22.0–40.3 сх.д. Усі 379
 * клієнтів лежать усередині (48.1–50.5 / 22.3–37.3), тож рамка нікого не
 * відрізає — вона лише не дає карті поїхати в порожнечу.
 *
 * Увага: Leaflet обмежує цією рамкою ЦЕНТР вікна, а не його край. На
 * дрібному масштабі половина екрана — це сотні кілометрів, тому з центром
 * рівно на межі половину екрана займає сусідня країна. Ширша рамка «із
 * запасом» цей ефект тільки подвоює: з нею карта доїжджала до Варшави.
 */
export const UKRAINE_BOUNDS: [[number, number], [number, number]] = [
  [44.0, 22.0],
  [52.5, 40.3],
];

/**
 * Не даємо карті виїхати за межі України.
 *
 * `maxBoundsViscosity: 1` робить край жорстким: карта не «відпружинює»
 * назад, а просто не пускає далі — на планшеті це відчувається як стінка,
 * а не як збій.
 *
 * minZoom 6, а не 5: на п'ятому країна займає третину екрана, решта —
 * сусіди, і карта знову виглядає «не про нас». Шостий показує Україну
 * майже на весь екран.
 */
export function clampToUkraine(map: L.Map) {
  map.setMaxBounds(UKRAINE_BOUNDS);
  map.options.maxBoundsViscosity = 1;
  map.setMinZoom(6);
}

/**
 * Вішає на готову мапу правило «колесо після кліку».
 *
 * Викликається один раз одразу після L.map(...), поруч із tileLayer:
 * підписки живуть стільки ж, скільки сама мапа, і знімати їх окремо не
 * треба — map.remove() забирає все.
 *
 * @param onWheelChange повідомляє рамці, показувати підказку чи вже ні
 */
export function attachWheelGate(map: L.Map, onWheelChange?: (active: boolean) => void) {
  map.on("click", () => {
    map.scrollWheelZoom.enable();
    onWheelChange?.(true);
  });
  closeWheelGateOn(map, onWheelChange);
}

/**
 * Друга половина воріт — умови, за яких колесо повертається сторінці.
 *
 * Винесена окремо, бо ClientMap відкриває ворота власним обробником кліку
 * (той самий клік ставить пін), а закриватися має за спільним правилом.
 *
 * Одного mouseout від Leaflet замало. На трекпаді курсор під час скролу
 * стоїть на місці: подія не приходить, і карта, раз увімкнена кліком, з'їдає
 * прокрутку назавжди — сторінка під нею не рухається, хоча меню позаду
 * гортається. Тому ворота закриває ще й вихід вказівника з контейнера
 * (pointerleave ловить і мишу, і перо, і зняття пальця) та будь-який скрол
 * сторінки: поїхала сторінка — карта втратила право на колесо, навіть якщо
 * курсор усе ще над нею. Наступний клік поверне зум.
 */
export function closeWheelGateOn(map: L.Map, onWheelChange?: (active: boolean) => void) {
  const container = map.getContainer();

  const close = () => {
    // На весь екран сторінки позаду немає: ні її скрол, ні вихід курсора
    // за край не мають відбирати колесо. Атрибут ставить сама рамка.
    if (container.closest("[data-map-fullscreen]")) return;
    map.scrollWheelZoom.disable();
    onWheelChange?.(false);
  };

  map.on("mouseout", close);
  container.addEventListener("pointerleave", close);

  const onPageScroll = () => {
    if (map.scrollWheelZoom.enabled()) close();
  };
  window.addEventListener("scroll", onPageScroll, { passive: true, capture: true });

  map.on("unload", () => {
    container.removeEventListener("pointerleave", close);
    window.removeEventListener("scroll", onPageScroll, { capture: true });
  });
}

/**
 * Обгортка навколо контейнера мапи.
 *
 * isolate створює власний стековий контекст: панелі Leaflet мають z-index до
 * 1000 і без цього перекривали б шапку та бічне меню при скролі — карта
 * «їздила» б поверх сторінки.
 *
 * contain тут свідомо НЕМАЄ. Спокуса додати `contain: layout paint` велика
 * (він теж тримає шари всередині блока), але на довгих сторінках з картою
 * посередині він з'їдає прокрутку: браузер перестає рахувати вміст під
 * картою, і до всього, що нижче неї, вже не догортати. Стековий контекст
 * від isolate вирішує ту саму задачу і без цієї ціни.
 *
 * Режим «на весь екран» — це той самий вузол, якому міняють класи, а НЕ
 * портал у body. Портал перемістив би DOM-вузол, React перемонтував би
 * контейнер, і жива L.Map лишилася б без нього — карта відкривалася б
 * заново, з нульовим зумом і втраченим вибором. Перекрити шелл вистачає
 * звичайного fixed: ні шапка, ні смужка вкладок, ні нижня навігація не
 * мають власного z-index (їхні z-50/z-70 — лише тимчасові меню), а
 * прецедент уже в коді — модалка надбавки в PayrollTab. Якщо шапка колись
 * стане липкою зі своїм z-index, це припущення зламається: тоді доведеться
 * платити порталом і перестворенням карти.
 */
export function MapFrame({
  height,
  wheelActive,
  hint = true,
  rounded = "12px",
  expanded = false,
  onToggleExpand,
  children,
}: {
  height: string;
  /** Чи колесо зараз масштабує — від нього залежить підказка внизу */
  wheelActive: boolean;
  /** Показувати підказку про клік. Вимикається там, де карта не для миші */
  hint?: boolean;
  rounded?: string;
  /** Розгорнута на весь екран — стан із useMapExpand */
  expanded?: boolean;
  /** Не передано — кнопки немає, рамка поводиться як раніше */
  onToggleExpand?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={
        expanded
          ? "fixed inset-0 z-[1200] isolate overflow-hidden bg-white"
          : "relative isolate overflow-hidden"
      }
      style={expanded ? undefined : { height, width: "100%", borderRadius: rounded }}
      data-map-fullscreen={expanded ? "" : undefined}
    >
      {children}
      {onToggleExpand && (
        // z-1001: панелі Leaflet усередині доходять до 1000, кнопка має
        // лишатися над ними — і над зумом у лівому верхньому куті.
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? "Згорнути карту (Esc)" : "Розгорнути карту на весь екран"}
          title={expanded ? "Згорнути (Esc)" : "На весь екран"}
          className="absolute right-2.5 top-[max(0.625rem,env(safe-area-inset-top,0px))] z-[1001] cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white/95 p-2 text-g600 shadow-[var(--shadow-card)] transition-colors hover:bg-g50 hover:text-bk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            {expanded ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            )}
          </svg>
        </button>
      )}
      {hint && !wheelActive && !expanded && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-[400] -translate-x-1/2 rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-gr shadow">
          Клікніть на карту, щоб масштабувати колесом
        </div>
      )}
    </div>
  );
}

/**
 * Стан підказки для карти в рамці.
 *
 * Колбек стабільний (useCallback без залежностей), тож його можна віддавати
 * в attachWheelGate усередині ефекту ініціалізації без ризику, що зміна
 * ідентичності функції змусить мапу перестворюватись.
 */
export function useWheelGate() {
  const [wheelActive, setWheelActive] = useState(false);
  const onWheelChange = useCallback((active: boolean) => setWheelActive(active), []);
  return { wheelActive, onWheelChange };
}

/**
 * Стан «карта на весь екран» разом із усім, що до нього додається.
 *
 * Головне тут — invalidateSize. Leaflet рахує розмір полотна один раз і
 * запам'ятовує; коли контейнер розтягується без зміни розміру вікна,
 * карта цього не помічає і домальовує тайли за старою сіткою — половина
 * екрана лишається сірою. rAF чекає на перерахунок розмітки, а повтор
 * через 150 мс ловить пізній випадок (шрифти, поява/зникнення смуги
 * прокрутки).
 *
 * Заразом на весь екран знімаємо ворота колеса: гортати позаду нічого, і
 * вимагати клік заради зуму тут немає сенсу. При згортанні правило
 * повертається.
 */
export function useMapExpand(mapRef: RefObject<L.Map | null>) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const raf = requestAnimationFrame(() => map.invalidateSize());
    const timer = window.setTimeout(() => map.invalidateSize(), 150);

    if (expanded) map.scrollWheelZoom.enable();
    else map.scrollWheelZoom.disable();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [expanded, mapRef]);

  useEffect(() => {
    if (!expanded) return;

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onEsc);

    // Сторінка під картою не має гортатися: інакше після згортання
    // повертаєшся зовсім не туди, звідки відкривав.
    const scroller = document.querySelector<HTMLElement>("[data-admin-scroll]");
    const prevOverflow = scroller?.style.overflow ?? null;
    if (scroller) scroller.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onEsc);
      if (scroller) scroller.style.overflow = prevOverflow ?? "";
    };
  }, [expanded]);

  return { expanded, toggle };
}
