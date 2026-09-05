/**
 * Мітка зупинки — спільна для карти зміни й карти дня водія.
 *
 * Була всередині ShiftTrackMap і малювалася лише торговим. Питання «де він
 * стояв і скільки» у водія те саме — на вивантаженні воно навіть прямолінійніше,
 * — а карта дня показувала саму лінію. Дві реалізації того самого піна
 * розійшлися б за пів року, тож він тут один.
 *
 * Кругла, на противагу квадратній мітці плану: план це намір, зупинка це
 * факт, і плутати їх на одній карті не можна. Номер — порядок за днем, тобто
 * маршрут читається пінами навіть із вимкненою лінією.
 */

import L from "leaflet";

/** Темний графіт: не сперечається ні з треком, ні з планом, ні зі статусами. */
export const STOP_COLOR = "#111827";

export type TrackStopDot = {
  seq: number;
  lat: number;
  lng: number;
  minutes: number;
  /** Час уже відформатований сервером — «HH:MM». */
  fromTime: string;
  toTime: string;
  counterpartyName: string | null;
  /** Скільки метрів від зупинки до точки того клієнта. */
  distanceM?: number | null;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function stopPin(seq: number, minutes: number): L.DivIcon {
  // Довші зупинки помітніші: 5 хвилин і година мають різну вагу для того,
  // хто дивиться на день згори.
  const size = minutes >= 30 ? 30 : minutes >= 15 ? 26 : 22;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${STOP_COLOR};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:${size >= 30 ? 13 : 11}px;
      border:2px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      font-family:system-ui,sans-serif;
    ">${seq}</div>`,
  });
}

/** Підпис піна: час, тривалість і клієнт, якщо він очевидний. */
export function stopTooltip(stop: TrackStopDot): string {
  return (
    `<b>${stop.fromTime}–${stop.toTime} · ${stop.minutes} хв</b>` +
    (stop.counterpartyName ? `<br/>${escapeHtml(stop.counterpartyName)}` : "")
  );
}

/** Кольори поділу руху — однакові на обох картах, інакше легенда бреше. */
/**
 * Кольори способів пересування — спільні для обох карт.
 *
 * REPEAT (повернення по власному сліду) навмисно не червоний і не
 * бурштиновий: перший на цих картах уже означає «після зміни», другий —
 * ходьбу. Два сенси на один колір роблять легенду непотрібною саме тоді,
 * коли вона найбільше потрібна.
 */
export const MOVE_COLOR = { DRIVE: "#2563EB", WALK: "#D97706", REPEAT: "#DB2777" } as const;
