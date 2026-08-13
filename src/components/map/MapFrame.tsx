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

import { useCallback, useState, type ReactNode } from "react";
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
  map.on("mouseout", () => {
    map.scrollWheelZoom.disable();
    onWheelChange?.(false);
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
 */
export function MapFrame({
  height,
  wheelActive,
  hint = true,
  rounded = "12px",
  children,
}: {
  height: string;
  /** Чи колесо зараз масштабує — від нього залежить підказка внизу */
  wheelActive: boolean;
  /** Показувати підказку про клік. Вимикається там, де карта не для миші */
  hint?: boolean;
  rounded?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="relative isolate overflow-hidden"
      style={{ height, width: "100%", borderRadius: rounded }}
    >
      {children}
      {hint && !wheelActive && (
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
