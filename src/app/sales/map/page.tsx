"use client";

/**
 * «Моя карта» — клієнти торгового на мапі з маршрутом на сьогодні.
 *
 * У списку клієнтів не видно найважливішого для роботи в полі: що троє
 * сплячих стоять уздовж дороги, якою торговий і так їде. Тут це видно
 * одразу — колір каже, з ким біда, а лінія маршруту показує, чи вони по
 * дорозі.
 *
 * Карта на весь екран, а не в картці: на телефоні кожен піксель зайвої
 * рамки — це мінус видима територія.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { CLIENT_STATE, type ClientStateKey } from "@/lib/analytics/colors";
import { useTrackRecorder } from "@/hooks/useTrackRecorder";
import { ClientOrderModal } from "@/app/admin/sales-analytics/components/ClientOrderModal";
import type { SalesClientPoint, SalesRoute } from "@/components/map/SalesClientsMap";

const SalesClientsMap = dynamic(() => import("@/components/map/SalesClientsMap"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", width: "100%", background: "#EEE" }} />,
});

/** Клієнт, якому ще не поставили пін: усе те саме, лише без координат. */
type UnmappedClient = Omit<SalesClientPoint, "lat" | "lng" | "approximate">;

type Resp = {
  day: string;
  clients: SalesClientPoint[];
  unmapped: UnmappedClient[];
  counts: Record<string, number>;
  route: SalesRoute;
  approximateCount: number;
};

/** Що показує пошук: точка на карті або клієнт, якого туди ще треба поставити. */
type Suggestion = {
  id: string;
  name: string;
  hint: string;
  state: ClientStateKey;
  lat: number | null;
  lng: number | null;
  rank: number;
};

/** Порядок у легенді: спершу те, з чим треба працювати. */
const LEGEND: ClientStateKey[] = ["ACTIVE", "NEW", "SLIPPING", "DORMANT", "LOST"];

export default function SalesMapPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [orderFor, setOrderFor] = useState<{
    id: string;
    name: string;
    state: ClientStateKey;
  } | null>(null);

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [focus, setFocus] = useState<{
    lat: number;
    lng: number;
    id?: string;
    nonce: number;
  } | null>(null);
  /** Кому зараз ставимо пін; поки не null — тап по карті зберігає координати. */
  const [pinFor, setPinFor] = useState<{ id: string; name: string } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  /**
   * Трек торгового вмикається кнопкою, а не сам.
   *
   * У водія планшет стоїть у тримачі весь день, тому там запис стартує
   * одразу. Торговий відкриває карту на телефоні між справами, і
   * автоматичний запис означав би, що телефон пише трек щоразу, коли той
   * просто глянув, хто поруч. Рішення лишаємо за людиною.
   */
  const [tracking, setTracking] = useState(false);
  const track = useTrackRecorder({ enabled: tracking });

  useEffect(() => {
    let alive = true;
    fetch("/api/sales/my-map")
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as Resp;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не вдалося завантажити"));
    return () => {
      alive = false;
    };
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }, []);

  /**
   * Підказки пошуку.
   *
   * Дані вже в пам'яті, тож список звужується з кожною літерою без запиту —
   * саме те, що просили: набрав перші букви й одразу бачиш, кого мав на увазі.
   * Шукаємо і по назві, і по адресі: клієнта пам'ятають або на прізвище, або
   * по тому, де він стоїть. Збіг на початку слова важить більше за збіг
   * усередині — «Стрий» має знайти Стрий, а не «Бистриця».
   *
   * Клієнти без піна теж у списку, і саме заради них усе робилося: інакше
   * пошук мовчить про клієнта, якого просто не геокодували, і це виглядає
   * так, ніби його немає в базі.
   */
  const suggestions = useMemo<Suggestion[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !data) return [];

    const rank = (haystack: string) => {
      const h = haystack.toLowerCase();
      const at = h.indexOf(q);
      if (at < 0) return -1;
      if (at === 0) return 0;
      return /[\s(,.«"]/.test(h[at - 1]) ? 1 : 2;
    };

    const rankOf = (name: string, address: string | null) =>
      Math.min(...[rank(name), rank(address ?? "")].filter((x) => x >= 0).concat([99]));

    const out: Suggestion[] = [];

    for (const c of data.clients) {
      const r = rankOf(c.name, c.address);
      if (r === 99) continue;
      out.push({
        id: c.id,
        name: c.name,
        hint: c.approximate ? "точка приблизна" : CLIENT_STATE[c.state].label,
        state: c.state,
        lat: c.lat,
        lng: c.lng,
        rank: r,
      });
    }

    // Без піна — нижче за тих, хто на карті, але в тому ж списку.
    for (const u of data.unmapped) {
      const r = rankOf(u.name, u.address);
      if (r === 99) continue;
      out.push({
        id: u.id,
        name: u.name,
        hint: "немає на карті",
        state: u.state,
        lat: null,
        lng: null,
        rank: r + 3,
      });
    }

    return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "uk")).slice(0, 12);
  }, [query, data]);

  /**
   * Вибір у пошуку.
   *
   * Клієнт із піном — просто підлітаємо до нього. Без піна — вмикаємо режим
   * постановки: далі торговий або тапає по карті, або тисне «Я тут» і пін
   * стає по GPS. Другий шлях головний: він стоїть біля дверей магазину, і
   * його власна позиція точніша за будь-який тап пальцем по мапі.
   */
  const pickSuggestion = useCallback((s: Suggestion) => {
    setSearchOpen(false);
    setQuery("");
    setPinError(null);
    if (s.lat != null && s.lng != null) {
      setPinFor(null);
      setFocus({ lat: s.lat, lng: s.lng, id: s.id, nonce: Date.now() });
    } else {
      setPinFor({ id: s.id, name: s.name });
    }
  }, []);

  /** Зберігає пін і оновлює карту, не перезавантажуючи весь список. */
  const savePin = useCallback(
    async (lat: number, lng: number) => {
      if (!pinFor) return;
      setPinBusy(true);
      setPinError(null);
      try {
        const res = await fetch(`/api/admin/client-map/${pinFor.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);

        // Переносимо клієнта з «без піна» на карту тут же: перезапит забрав
        // би секунди й скинув би вигляд карти, а нових даних, крім координат,
        // у відповіді немає.
        setData((prev) => {
          if (!prev) return prev;
          const moved = prev.unmapped.find((u) => u.id === pinFor.id);
          const counts = { ...prev.counts };
          if (moved) counts[moved.state] = (counts[moved.state] ?? 0) + 1;
          return {
            ...prev,
            unmapped: prev.unmapped.filter((u) => u.id !== pinFor.id),
            clients: moved
              ? [...prev.clients, { ...moved, lat, lng, geoSource: "MANUAL", approximate: false }]
              : prev.clients.map((c) =>
                  c.id === pinFor.id
                    ? { ...c, lat, lng, geoSource: "MANUAL", approximate: false }
                    : c
                ),
            counts,
          };
        });
        setPinFor(null);
        setFocus({ lat, lng, id: pinFor.id, nonce: Date.now() });
      } catch (e) {
        setPinError(e instanceof Error ? e.message : "Не вдалося зберегти точку");
      } finally {
        setPinBusy(false);
      }
    },
    [pinFor]
  );

  /** «Я зараз тут» — пін по власному GPS. */
  const pinHere = useCallback(() => {
    if (!navigator.geolocation) {
      setPinError("Телефон не дає геолокацію");
      return;
    }
    setPinBusy(true);
    setPinError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => savePin(p.coords.latitude, p.coords.longitude),
      () => {
        setPinBusy(false);
        setPinError("Не вдалося отримати ваше місце. Увімкніть геолокацію або тапніть по карті.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [savePin]);

  const toggle = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const visible = (data?.clients ?? []).filter((c) => !hidden.has(c.state));

  return (
    // Фіксований шар на всю висоту мінус нижнє меню: карті потрібен весь екран.
    <div
      className="fixed inset-x-0"
      style={{
        top: 0,
        bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))",
        background: "#F7F7F7",
      }}
    >
      <div className="absolute inset-0">
        {/* Поки трек іде, позиція оновлюється сама — кнопка «де я» потрібна
            лише коли запис вимкнено. */}
        <SalesClientsMap
          clients={visible}
          route={data?.route ?? null}
          me={track.position ?? me}
          pinning={!!pinFor}
          onMapClick={savePin}
          focus={focus}
          // «Уточнити точку» прямо з попапа: приблизний пін видно саме тоді,
          // коли торговий стоїть біля магазину й дивиться на карту.
          extras={{ clientCardHref: "/sales/clients/", pin: true }}
          onAction={(a) => {
            const c = data?.clients.find((x) => x.id === a.id);
            if (!c) return;
            if (a.kind === "pin") {
              setPinError(null);
              setPinFor({ id: c.id, name: c.name });
              return;
            }
            setOrderFor({ id: c.id, name: c.name, state: c.state });
          }}
        />
      </div>

      {/* Шапка поверх карти: назад і маршрут дня */}
      <div
        className="absolute inset-x-0 top-0 z-[500] flex items-center gap-2 px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)",
          paddingBottom: "10px",
          background: "linear-gradient(#F7F7F7EE, #F7F7F700)",
        }}
      >
        <Link
          href="/sales"
          aria-label="Назад"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.15)", textDecoration: "none" }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>

        {/* Пошук на місці смужки маршруту: у полі його відкривають, щоб
            знайти конкретного клієнта, а назва маршруту — довідка, яку
            досить бачити в розгорнутій панелі внизу. */}
        <div className="relative min-w-0 flex-1">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            // Затримка: без неї тап по підказці не встигає спрацювати —
            // blur ховає список раніше за onClick.
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Пошук клієнта: прізвище, адреса…"
            aria-label="Пошук клієнта"
            className="w-full rounded-full px-3.5 py-2"
            style={{
              background: "#fff",
              boxShadow: "0 1px 6px rgba(0,0,0,0.12)",
              border: "none",
              fontSize: "14px",
              color: "#0A0A0A",
              outline: "none",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSearchOpen(false);
              }}
              aria-label="Очистити пошук"
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full"
              style={{ background: "none", border: "none", color: "#9CA3AF", fontSize: "17px" }}
            >
              ×
            </button>
          )}

          {searchOpen && suggestions.length > 0 && (
            <ul
              className="absolute left-0 right-0 top-full mt-1 overflow-y-auto rounded-2xl"
              style={{
                background: "#fff",
                boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
                maxHeight: "min(52vh, 340px)",
                listStyle: "none",
                margin: "4px 0 0",
                padding: 0,
              }}
            >
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(s)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                    style={{ background: "none", border: "none" }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: "9px",
                        height: "9px",
                        borderRadius: "50%",
                        background: CLIENT_STATE[s.state].color,
                        flexShrink: 0,
                        // Порожнистий кружок — клієнт ще не на карті.
                        boxShadow: s.lat == null ? "inset 0 0 0 9px #fff, 0 0 0 1.5px currentColor" : "none",
                        color: CLIENT_STATE[s.state].color,
                      }}
                    />
                    <span
                      className="min-w-0 flex-1 truncate"
                      style={{ fontSize: "14px", color: "#0A0A0A" }}
                    >
                      {s.name}
                    </span>
                    <span
                      className="shrink-0"
                      style={{ fontSize: "11px", color: s.lat == null ? "#D97706" : "#9CA3AF" }}
                    >
                      {s.hint}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {searchOpen && query.trim().length >= 2 && suggestions.length === 0 && (
            <div
              className="absolute left-0 right-0 top-full mt-1 rounded-2xl px-3 py-2.5"
              style={{ background: "#fff", boxShadow: "0 6px 20px rgba(0,0,0,0.18)" }}
            >
              <p style={{ fontSize: "12px", color: "#9CA3AF", margin: 0 }}>
                Нічого не знайдено серед ваших клієнтів.
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={locate}
          aria-label="Де я"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.15)", border: "none" }}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke={locating ? "#9CA3AF" : "#2563EB"}
            strokeWidth={1.9}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            <circle cx="12" cy="12" r="6" />
          </svg>
        </button>

        {/* Запис треку: поки йде — показуємо пробіг, щоб було видно, що
            воно працює, і щоб не забули вимкнути після роботи. */}
        <button
          type="button"
          onClick={() => setTracking((v) => !v)}
          aria-label={tracking ? "Зупинити запис маршруту" : "Записувати маршрут"}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3"
          style={{
            background: tracking ? "#DC2626" : "#fff",
            color: tracking ? "#fff" : "#0A0A0A",
            boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
            border: "none",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          <span
            aria-hidden
            style={{
              width: "8px",
              height: "8px",
              borderRadius: tracking ? "2px" : "50%",
              background: tracking ? "#fff" : "#DC2626",
              display: "inline-block",
            }}
          />
          {tracking
            ? track.status === "buffering"
              ? "Немає звʼязку"
              : `${track.distanceKm} км`
            : "Записати"}
        </button>
      </div>

      {error && (
        <div
          className="absolute inset-x-3 z-[500] rounded-xl p-3"
          style={{ top: "70px", background: "#FEF2F2", border: "1px solid #FECACA" }}
        >
          <p style={{ fontSize: "13px", color: "#B91C1C" }}>{error}</p>
        </div>
      )}

      {/* Постановка піна: панель угорі, щоб не закривати карту знизу, де
          зазвичай і цілять пальцем. */}
      {pinFor && (
        <div
          className="absolute inset-x-3 z-[600] rounded-2xl p-3"
          style={{ top: "62px", background: "#0A0A0A", boxShadow: "0 6px 20px rgba(0,0,0,0.3)" }}
        >
          <p style={{ fontSize: "13px", color: "#fff", fontWeight: 600, margin: 0 }}>
            {pinFor.name}
          </p>
          <p style={{ fontSize: "12px", color: "#D1D5DB", margin: "3px 0 0", lineHeight: 1.4 }}>
            {pinBusy
              ? "Зберігаю…"
              : "Тапніть по карті, де стоїть клієнт, або натисніть «Я тут», якщо ви вже на місці."}
          </p>
          {pinError && (
            <p style={{ fontSize: "12px", color: "#FCA5A5", margin: "6px 0 0" }}>{pinError}</p>
          )}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={pinHere}
              disabled={pinBusy}
              className="flex-1 rounded-full px-3 py-2"
              style={{
                background: "#fff",
                color: "#0A0A0A",
                border: "none",
                fontSize: "13px",
                fontWeight: 600,
                opacity: pinBusy ? 0.6 : 1,
              }}
            >
              Я зараз тут
            </button>
            <button
              type="button"
              onClick={() => {
                setPinFor(null);
                setPinError(null);
              }}
              disabled={pinBusy}
              className="rounded-full px-3 py-2"
              style={{
                background: "transparent",
                color: "#D1D5DB",
                border: "1px solid #4B5563",
                fontSize: "13px",
              }}
            >
              Скасувати
            </button>
          </div>
        </div>
      )}

      {/* Нижня панель: легенда-фільтр. Згорнута — смужка з підсумком,
          щоб не з'їдати карту; розгортається тапом. */}
      {data && (
        <div
          className="absolute inset-x-0 bottom-0 z-[500] px-3 pb-3"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="rounded-2xl"
            style={{
              background: "#fff",
              boxShadow: "0 -1px 12px rgba(0,0,0,0.12)",
              pointerEvents: "auto",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3"
              style={{ background: "none", border: "none" }}
            >
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
                {visible.length} клієнтів на карті
              </span>
              {data.approximateCount > 0 && (
                <span style={{ fontSize: "12px", color: "#D97706" }}>
                  ⌖ {data.approximateCount} приблизних
                </span>
              )}
              {data.unmapped.length > 0 && (
                <span style={{ fontSize: "12px", color: "#9CA3AF" }}>
                  {data.unmapped.length} без піна
                </span>
              )}
              <svg
                className="ml-auto h-4 w-4"
                style={{ transform: sheetOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="#9CA3AF"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </button>

            {sheetOpen && (
              <div className="px-3 pb-3">
                {/* Маршрут дня переїхав сюди з шапки, коли там став пошук. */}
                <p style={{ fontSize: "12px", color: "#6B7280", margin: "0 0 8px" }}>
                  {data.route ? (
                    <>
                      Сьогодні: <strong style={{ color: "#0A0A0A" }}>{data.route.name}</strong>
                      {data.route.totalDistanceKm
                        ? ` · ${Math.round(data.route.totalDistanceKm)} км`
                        : ""}
                    </>
                  ) : (
                    "Маршрут на сьогодні не призначений"
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {LEGEND.map((k) => {
                    const off = hidden.has(k);
                    const n = data.counts[k] ?? 0;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggle(k)}
                        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5"
                        style={{
                          border: "1px solid #E5E7EB",
                          background: off ? "#F3F4F6" : "#fff",
                          opacity: off ? 0.55 : 1,
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: "9px",
                            height: "9px",
                            borderRadius: "50%",
                            background: CLIENT_STATE[k].color,
                          }}
                        />
                        <span style={{ fontSize: "12px", color: "#0A0A0A" }}>{CLIENT_STATE[k].label}</span>
                        <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{n}</span>
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "8px", lineHeight: 1.4 }}>
                  Тапніть точку, щоб побачити, що клієнт брав і що йому запропонувати.
                  Щоб виправити чи поставити пін — знайдіть клієнта пошуком угорі:
                  станьте біля магазину й натисніть «Я зараз тут».
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* key по клієнту: без нього тап по іншій точці лишав би на екрані
          замовлення попереднього, поки вантажаться нові. */}
      {orderFor && (
        <ClientOrderModal key={orderFor.id} client={orderFor} onClose={() => setOrderFor(null)} />
      )}
    </div>
  );
}
