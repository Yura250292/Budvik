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
 * «їздила» б поверх сторінки. contain: layout paint не дає її шарам
 * впливати на розкладку решти сторінки.
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
      style={{ height, width: "100%", borderRadius: rounded, contain: "layout paint" }}
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
