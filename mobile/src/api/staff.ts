/**
 * Клієнт робочих роутів кабінету.
 *
 * Окремий від src/api/client.ts, і не через стиль: той шар ходить винятково в
 * /api/v1/* з токеном магазину, а робочі екрани стукають у самі роути кабінету
 * (/api/shift/*, /api/tablet/day, /api/erp/*) з токеном області track. Спільна
 * функція мусила б перемикати і префікс, і область — тобто вміти помилитися
 * контуром, а це рівно та помилка, заради унеможливлення якої області й
 * розділені.
 *
 * Роути кабінету навчилися приймати Bearer нарівні з кукі (src/lib/app/identity.ts
 * на сервері), тож нативному екрану більше не потрібен WebView, щоб дістатися
 * даних.
 */

import { API_BASE } from "./client";
import { getToken, clearToken } from "@/lib/auth-store";
import { APP_VERSION, APP_VERSION_CODE, STAFF_APP_HEADER } from "@/lib/app-version";

export { APP_VERSION, APP_VERSION_CODE };
/** Мітка збірки в кожному запиті — див. src/lib/app-version.ts. */
export const APP_HEADER = STAFF_APP_HEADER;

export class StaffApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * Що робити, коли сервер сказав 401.
 *
 * Ставиться ззовні (у track/controller.ts), щоб цей модуль не імпортував
 * трекер: 401 мусить не лише стерти токен, а й зупинити фонову службу — інакше
 * вона довбала б сервер відкликаним токеном до кінця дня.
 */
let onUnauthorized: (() => Promise<void>) | null = null;
export function setUnauthorizedHandler(fn: () => Promise<void>) {
  onUnauthorized = fn;
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Готове тіло (multipart) — тоді Content-Type ставить сам FormData. */
  form?: FormData;
  /** Вхід і реєстрація йдуть без токена. */
  anonymous?: boolean;
};

export async function staffRequest<T>(path: string, opts: Options = {}): Promise<T> {
  const token = opts.anonymous ? null : await getToken();

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    headers: {
      "x-budvik-app": APP_HEADER,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });

  if (res.status === 401 && !opts.anonymous) {
    /**
     * 401 означає рівно одне: токен мертвий. Сервер навмисно розрізняє його і
     * 403 («увійшов, але сюди не можна») — інакше застосунок викидав би людину
     * з акаунта на кожній забороні.
     */
    await clearToken();
    await onUnauthorized?.();
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new StaffApiError(body?.error ?? `Сервер відповів ${res.status}`, res.status);
  }

  // 204 і порожнє тіло теж бувають — не падаємо на порожньому JSON.
  return (await res.json().catch(() => null)) as T;
}

/* ---------- День водія ---------- */

/**
 * Точка дня. Форма — з src/lib/track/day-stop-type.ts на сервері; тримати її
 * тут копією доводиться тому, що застосунок не має доступу до коду сайту.
 * Розбіжність виявиться як порожні поля на екрані, тож змінювати серверний тип
 * без правки тут не можна.
 */
export type DayStop = {
  key: string;
  counterpartyId: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  sequence: number;
  amount: number;
  debtAmount: number;
  /** PICKUP/ERRAND — бонусна поїздка: без товару й без інкасації. */
  kind: "DELIVERY" | "PICKUP" | "ERRAND";
  notes: string | null;
  visit: { status: string; money: string; collectedAmount: number | null } | null;
};

export type Handover = {
  id: string;
  amount: number;
  confirmedAt: string | null;
  confirmedAmount: number | null;
  comment: string | null;
};

export type DayCash = {
  collected: number;
  handed: number;
  /** Скільки грошей водій везе просто зараз. Рахує сервер — клієнту тут не вірять. */
  onHands: number;
  handovers: Handover[];
};

export type DayResponse = {
  day: string;
  role: string;
  route: {
    source: string | null;
    number: string | null;
    stops: DayStop[];
  } | null;
  progress: {
    total: number;
    done: number;
    missed: number;
    left: number;
    collected: number;
    debtPlanned: number;
  };
  track: { distanceKm: number; pointsCount: number; lastPointAt: string | null };
  cash: DayCash;
};

export type VisitInput = {
  counterpartyId: string;
  status: "DONE" | "MISSED";
  money: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";
  debtAmount?: number | null;
  collectedAmount?: number | null;
  comment?: string | null;
  routeSheetStopId?: string | null;
  deliveryStopId?: string | null;
  lat?: number | null;
  lng?: number | null;
};

/* ---------- Зміна ---------- */

export type ShiftState = {
  serverTime: string;
  shift: {
    id: string;
    startedAt: string;
    startOdometer: number | null;
    gpsDistanceKm: number | null;
    hoursOpen: number | null;
    shouldRemindToClose: boolean;
  } | null;
  previous: { endOdometer: number | null; endedAt: string | null; distanceKm: number | null } | null;
};

export const staffApi = {
  shiftCurrent: () => staffRequest<ShiftState>("/api/shift/current"),

  shiftOpen: (body: Record<string, unknown>) =>
    staffRequest<unknown>("/api/shift/open", { method: "POST", body }),

  shiftClose: (body: Record<string, unknown>) =>
    staffRequest<unknown>("/api/shift/close", { method: "POST", body }),

  shiftHistory: () => staffRequest<unknown>("/api/shift/history"),

  /** Розпізнавання одометра: фото йде multipart, бо це файл, а не JSON. */
  odometerRecognize: (form: FormData) =>
    staffRequest<{ readId?: string; value?: number | null; message?: string }>(
      "/api/shift/odometer/recognize",
      { method: "POST", form }
    ),

  /* ---------- Трек ---------- */

  trackPoints: (body: { points: unknown[]; phase?: string }) =>
    staffRequest<{ accepted: number; sessionDistanceKm: number }>("/api/track/points", {
      method: "POST",
      body,
    }),

  heartbeat: (body: Record<string, unknown>) =>
    staffRequest<{ shouldTrack?: boolean; shiftOpen?: boolean }>("/api/track/heartbeat", {
      method: "POST",
      body,
    }),

  /* ---------- День водія ---------- */

  day: (day?: string) =>
    staffRequest<DayResponse>(`/api/tablet/day${day ? `?day=${day}` : ""}`),

  markVisit: (body: VisitInput) =>
    staffRequest<{ visit: { id: string } }>("/api/visits", { method: "POST", body }),

  /** Бонусна поїздка не має клієнта — її станом служить сам DeliveryStop. */
  markErrand: (stopId: string, body: { status: "DELIVERED" | "FAILED"; comment?: string }) =>
    staffRequest<unknown>(`/api/erp/delivery-routes/stop/${stopId}/mark`, {
      method: "POST",
      body,
    }),

  cashHandover: (body: { amount: number; day?: string; comment?: string }) =>
    staffRequest<{ cash: DayCash }>("/api/driver/cash-handover", { method: "POST", body }),

  cancelHandover: (id: string) =>
    staffRequest<unknown>(`/api/driver/cash-handover?id=${id}`, { method: "DELETE" }),

  /* ---------- Збірка й вихід ---------- */

  staffVersion: () =>
    staffRequest<{
      versionCode: number;
      versionName: string;
      minVersionCode: number;
      sizeBytes: number;
    }>("/api/app/staff/version"),

  /** Гасить токен цього пристрою на сервері, а не лише в памʼяті телефона. */
  logout: () => staffRequest<{ ok: boolean }>("/api/device/logout", { method: "POST" }),
};
