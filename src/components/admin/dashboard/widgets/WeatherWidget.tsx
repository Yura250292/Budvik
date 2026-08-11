"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useApi } from "@/app/admin/sales-analytics/components/useApi";
import type { WeatherResponse } from "@/app/api/admin/tools/weather/route";
import { WidgetBody } from "./parts";

/**
 * Погода за геолокацією.
 *
 * Дозвіл на геолокацію не питаємо на старті: браузерний промпт при
 * кожному заході на дашборд дратує, а більшість користувачів сидять в
 * офісі. Спершу показуємо збережене (або дефолтне) місто, а геолокацію
 * вмикає сам користувач — і тоді вибір запам'ятовується.
 */

const CITIES = [
  { name: "Тернопіль", lat: 49.5535, lon: 25.5948 },
  { name: "Київ", lat: 50.4501, lon: 30.5234 },
  { name: "Львів", lat: 49.8397, lon: 24.0297 },
  { name: "Хмельницький", lat: 49.4229, lon: 26.9871 },
  { name: "Івано-Франківськ", lat: 48.9226, lon: 24.7111 },
  { name: "Рівне", lat: 50.6199, lon: 26.2516 },
  { name: "Луцьк", lat: 50.7472, lon: 25.3254 },
  { name: "Чернівці", lat: 48.2921, lon: 25.9358 },
  { name: "Вінниця", lat: 49.2331, lon: 28.4682 },
  { name: "Одеса", lat: 46.4825, lon: 30.7233 },
  { name: "Дніпро", lat: 48.4647, lon: 35.0462 },
  { name: "Харків", lat: 49.9935, lon: 36.2304 },
] as const;

const STORE_KEY = "budvik:admin:weather-place:v1";

type Place = { name: string; lat: number; lon: number; geo?: boolean };

/**
 * Збережене місто з localStorage.
 *
 * Через useSyncExternalStore, а не читанням у useEffect: сервер і перший
 * клієнтський рендер мають віддати однакову розмітку (інакше гідратація
 * розходиться), а далі React сам підхопить локальне значення. Заразом це
 * тримає обидва віджети погоди на одному місті — підписка спільна.
 */
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Вибір міста в сусідній вкладці має долетіти й сюди.
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Кеш розібраного значення: getSnapshot має віддавати стабільне посилання. */
let cachedRaw: string | null = null;
let cachedPlace: Place = CITIES[0];

function getSnapshot(): Place {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    return cachedPlace;
  }
  if (raw === cachedRaw) return cachedPlace;

  cachedRaw = raw;
  if (raw) {
    try {
      const saved = JSON.parse(raw) as Place;
      if (typeof saved?.lat === "number" && typeof saved?.lon === "number") cachedPlace = saved;
    } catch {
      /* зіпсований запис — лишаємо попереднє */
    }
  }
  return cachedPlace;
}

/** На сервері localStorage немає — віддаємо дефолт. */
const getServerSnapshot = (): Place => CITIES[0];

function savePlace(next: Place) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* приватний режим — місто просто не запам'ятається */
  }
  for (const cb of listeners) cb();
}

function useStoredPlace(): [Place, (next: Place) => void] {
  const place = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [place, savePlace];
}

/**
 * Коди WMO → підпис і піктограма. Групуємо: розрізняти «легку» й
 * «помірну» мряку на плитці 2x1 користі не дає.
 */
function describe(code: number, isDay = true): { label: string; icon: string } {
  if (code === 0) return { label: "Ясно", icon: isDay ? "☀️" : "🌙" };
  if (code <= 2) return { label: "Мінлива хмарність", icon: isDay ? "🌤️" : "☁️" };
  if (code === 3) return { label: "Хмарно", icon: "☁️" };
  if (code <= 48) return { label: "Туман", icon: "🌫️" };
  if (code <= 57) return { label: "Мряка", icon: "🌦️" };
  if (code <= 67) return { label: "Дощ", icon: "🌧️" };
  if (code <= 77) return { label: "Сніг", icon: "🌨️" };
  if (code <= 82) return { label: "Злива", icon: "🌧️" };
  if (code <= 86) return { label: "Снігопад", icon: "🌨️" };
  return { label: "Гроза", icon: "⛈️" };
}

const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" }).format(
    new Date(iso)
  );

const weekday = (iso: string) =>
  new Intl.DateTimeFormat("uk-UA", { weekday: "short", timeZone: "Europe/Kyiv" }).format(new Date(`${iso}T12:00:00`));

export function WeatherWidget() {
  const [place, setPlace] = useStoredPlace();
  const [picking, setPicking] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const choose = (next: Place) => {
    setPlace(next);
    setPicking(false);
    setGeoError(null);
  };

  const useGeo = () => {
    if (!navigator.geolocation) {
      setGeoError("Браузер не підтримує геолокацію");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        choose({
          name: "Моє місце",
          lat: Number(pos.coords.latitude.toFixed(2)),
          lon: Number(pos.coords.longitude.toFixed(2)),
          geo: true,
        }),
      () => setGeoError("Доступ до геолокації закрито"),
      { timeout: 8000, maximumAge: 600_000 }
    );
  };

  const { data, loading, error } = useApi<WeatherResponse>(
    `/api/admin/tools/weather?lat=${place.lat}&lon=${place.lon}`
  );

  const now = data?.current;
  const sky = now ? describe(now.code, now.isDay) : null;

  return (
    <WidgetBody
      title="Погода"
      hint={place.geo ? "За вашою геолокацією" : place.name}
      loading={loading && !data}
      error={error}
    >
      {picking ? (
        <div className="flex h-full flex-col">
          <button
            type="button"
            onClick={useGeo}
            className="mb-2 rounded-[var(--radius-btn)] border border-g200 px-3 py-1.5 text-[12px] font-semibold text-bk transition-colors hover:bg-g50"
          >
            📍 Моє місцеположення
          </button>
          {geoError && <p className="mb-2 text-[11px] text-[#C62828]">{geoError}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {CITIES.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => choose(c)}
                className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-g50 ${
                  place.name === c.name ? "font-semibold text-bk" : "text-g600"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        now &&
        data && (
          <div className="flex h-full flex-col justify-between gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[28px] font-bold leading-none tabular-nums text-bk">{now.temp}°</p>
                <p className="mt-1 truncate text-[12px] text-g500">
                  {sky?.label} · відчувається {now.feels}°
                </p>
                <p className="mt-0.5 truncate text-[11px] text-g400">
                  {data.today.min}°…{data.today.max}° · вітер {now.wind} км/год
                  {data.today.precipitation > 0 && ` · опади ${data.today.precipitation}%`}
                </p>
              </div>
              <span aria-hidden className="flex-shrink-0 text-[34px] leading-none">
                {sky?.icon}
              </span>
            </div>

            {/* Погодинний зріз — головне, що потрібно торговому перед виїздом. */}
            <div className="flex gap-3 overflow-x-auto">
              {data.hourly.slice(0, 6).map((h) => (
                <div key={h.time} className="flex min-w-[42px] flex-col items-center gap-0.5">
                  <span className="text-[10px] text-g400">{hhmm(h.time)}</span>
                  <span aria-hidden className="text-[15px] leading-none">
                    {describe(h.code).icon}
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums text-bk">{h.temp}°</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setPicking(true)}
              className="self-start text-[11px] font-medium text-g400 transition-colors hover:text-bk"
            >
              Змінити місто →
            </button>
          </div>
        )
      )}
    </WidgetBody>
  );
}

/** Розширений варіант — з прогнозом на кілька днів (розмір 2x2 і більше). */
export function WeatherForecast() {
  // Місто спільне з основним віджетом погоди — міняється там.
  const [place] = useStoredPlace();

  const { data, loading, error } = useApi<WeatherResponse>(
    `/api/admin/tools/weather?lat=${place.lat}&lon=${place.lon}`
  );

  const days = useMemo(() => data?.daily ?? [], [data]);

  return (
    <WidgetBody
      title="Прогноз погоди"
      hint={place.geo ? "За вашою геолокацією" : place.name}
      loading={loading && !data}
      error={error}
      empty={!!data && days.length === 0}
    >
      <div className="h-full overflow-y-auto">
        {days.map((d, i) => {
          const sky = describe(d.code);
          return (
            <div key={d.date} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="text-[16px] leading-none">
                  {sky.icon}
                </span>
                <span className="truncate text-[13px] text-bk">{i === 0 ? "Сьогодні" : weekday(d.date)}</span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-3">
                {d.precipitation > 0 && (
                  <span className="text-[11px] tabular-nums text-g400">💧{d.precipitation}%</span>
                )}
                <span className="text-[13px] font-semibold tabular-nums text-bk">
                  {d.max}° <span className="font-normal text-g400">{d.min}°</span>
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </WidgetBody>
  );
}
