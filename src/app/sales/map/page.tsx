"use client";

/**
 * Карта клієнтів торгового з маршрутом на сьогодні.
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
import useSWR from "swr";
import { CLIENT_STATE, type ClientStateKey } from "@/lib/analytics/colors";
import { useTrackRecorder } from "@/hooks/useTrackRecorder";
import { ClientOrderModal } from "@/app/admin/sales-analytics/components/ClientOrderModal";
import { ClientCommentsModal } from "@/app/admin/sales-analytics/components/ClientCommentsModal";
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
  mineCount: number;
};

/**
 * Обсяг карти.
 *
 * Раніше вибірка була жорстко «мої» — і торговий на новій території бачив
 * три точки, поки в керівника на тій самій території їх сотні: закріплення
 * заповнюється руками, а документи з 1С прив'язуються зіставленням імені.
 * Тепер за замовчуванням видно всю базу, свої — окремим фільтром.
 */
type Scope = "mine" | "all";

/** Що показує пошук: точка на карті або клієнт, якого туди ще треба поставити. */
type Suggestion = {
  id: string;
  name: string;
  hint: string;
  state: ClientStateKey;
  lat: number | null;
  lng: number | null;
  rank: number;
  /** Свій клієнт: потрібне, щоб вибір чужого сам перемкнув карту на «Всі». */
  mine: boolean;
};

/** Порядок у легенді: спершу те, з чим треба працювати. */
const LEGEND: ClientStateKey[] = ["ACTIVE", "NEW", "SLIPPING", "DORMANT", "LOST"];

/**
 * «Нові» на карті не показуємо, поки їх не попросять.
 *
 * У цьому стані опиняється не лише той, хто щойно почав брати. Класифікація
 * ставить NEW і тому, у кого взагалі немає жодного документа, — а таких на
 * карті 2 608 із 3 042, тоді як справді нових (перша покупка за 30 днів) —
 * 22. Виходила стіна синього по всій Україні, крізь яку не видно ані
 * стабільних, ані втрачених: рівно те, заради чого карту й відкривають.
 *
 * Саме сховати, а не викинути: контрагент без документів — це не сміття, а
 * підказка «сюди ще ніхто не заходив». Просто це інше завдання, ніж робота
 * з маршрутом, і воно не мусить лізти в очі щодня.
 *
 * Класифікацію не чіпаємо: стани навмисно спільні з аналітикою керівника
 * (див. /api/sales/my-map), і розводити NEW на два різні тут означало б
 * розвести колір на одному клієнті в торгового й у керівника.
 */
const HIDDEN_BY_DEFAULT: ClientStateKey[] = ["NEW"];

/** Вибір людини переживає перехід на сусідню вкладку й назад. */
const HIDDEN_KEY = "budvik.sales.map.hidden.v1";

export default function SalesMapPage() {
  const [hidden, setHidden] = useState<Set<string>>(new Set(HIDDEN_BY_DEFAULT));
  const [scope, setScope] = useState<Scope>("all");
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [orderFor, setOrderFor] = useState<{
    id: string;
    name: string;
    state: ClientStateKey;
  } | null>(null);
  /** Кому пишемо нотатку або робимо фото локації. */
  const [notesFor, setNotesFor] = useState<{ id: string; name: string } | null>(null);
  /** Відкритий список тих, кого ще немає на карті. */
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");

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

  /**
   * Карта живе в кеші SWR, а не в стані сторінки.
   *
   * Раніше тут був fetch у useEffect, тобто відповідь помирала разом із
   * розмонтуванням: торговий тапав «Клієнти» й назад — і карта качала ті
   * самі 3.6 тис. точок наново, показуючи порожній екран, поки вони їдуть.
   * Саме це читалося як «не перемикається». Кеш SWR живе поза деревом
   * React, тож повернення на вкладку малює точки миттєво.
   *
   * dedupingInterval 5 хв: стани клієнтів і маршрут дня за цей час не
   * змінюються, а от перемикають вкладки в полі щохвилини.
   */
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR<Resp>(
    // Тягнемо одразу всю базу, а перемикач «Мої/Всі» працює вже в пам'яті:
    // повторний запит по мобільному в полі коштує дорожче за зайві рядки.
    "/api/sales/my-map?scope=all",
    async (url: string) => {
      const r = await fetch(url);
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
      return j as Resp;
    },
    { dedupingInterval: 5 * 60_000, revalidateOnFocus: false, keepPreviousData: true }
  );

  const error =
    loadError instanceof Error
      ? loadError.message
      : loadError
        ? "Не вдалося завантажити"
        : null;

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
        // Пошук іде по ВСІЙ базі незалежно від перемикача: людина шукає
        // конкретного клієнта, а не «клієнта в поточному фільтрі».
        hint: c.mine === false ? "не ваш" : c.approximate ? "точка приблизна" : CLIENT_STATE[c.state].label,
        state: c.state,
        lat: c.lat,
        lng: c.lng,
        rank: r,
        mine: c.mine !== false,
      });
    }

    // Без піна — нижче за тих, хто на карті, але в тому ж списку.
    for (const u of data.unmapped) {
      const r = rankOf(u.name, u.address);
      if (r === 99) continue;
      out.push({
        id: u.id,
        name: u.name,
        hint: u.mine === false ? "не ваш, немає на карті" : "немає на карті",
        state: u.state,
        lat: null,
        lng: null,
        rank: r + 3,
        mine: u.mine !== false,
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
    // Знайшли чужого, а на карті зараз лише свої — перемикаємо самі.
    // Інакше карта підлетіла б до порожнього місця: точки в цьому зрізі немає.
    if (!s.mine) setScope("all");
    if (s.lat != null && s.lng != null) {
      setPinFor(null);
      setFocus({ lat: s.lat, lng: s.lng, id: s.id, nonce: Date.now() });
    } else {
      setPinFor({ id: s.id, name: s.name });
    }
  }, []);

  /** Зберігає пін і оновлює карту, не перезавантажуючи весь список. */
  const savePin = useCallback(
    /**
     * accuracyM приходить лише зі шляху «Я зараз тут»: тап по карті точності
     * не має за визначенням. Порожнє поле в базі — це і є відповідь на
     * питання, чи людина була на місці.
     */
    async (lat: number, lng: number, accuracyM?: number | null) => {
      if (!pinFor) return;
      setPinBusy(true);
      setPinError(null);
      try {
        const res = await fetch(`/api/admin/client-map/${pinFor.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng, accuracyM: accuracyM ?? null }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);

        // Переносимо клієнта з «без піна» на карту тут же: перезапит забрав
        // би секунди й скинув би вигляд карти, а нових даних, крім координат,
        // у відповіді немає. revalidate:false саме тому — інакше mutate
        // сходив би на сервер і звів би нанівець усю економію.
        await mutate(
          (prev) => {
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
          },
          { revalidate: false }
        );
        setPinFor(null);
        setFocus({ lat, lng, id: pinFor.id, nonce: Date.now() });
      } catch (e) {
        setPinError(e instanceof Error ? e.message : "Не вдалося зберегти точку");
      } finally {
        setPinBusy(false);
      }
    },
    [pinFor, mutate]
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
      (p) => savePin(p.coords.latitude, p.coords.longitude, Math.round(p.coords.accuracy)),
      () => {
        setPinBusy(false);
        setPinError("Не вдалося отримати ваше місце. Увімкніть геолокацію або тапніть по карті.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [savePin]);

  /**
   * Збережений вибір читаємо ПІСЛЯ монтування, а не в початковому стані:
   * сторінка пререндериться статично, і localStorage у ініціалізаторі дав
   * би розбіжність гідратації.
   */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HIDDEN_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) setHidden(new Set(saved as string[]));
      }
    } catch {
      // Приватний режим або переповнена квота — лишаємось на замовчуванні.
    }
  }, []);

  const toggle = (k: string) => {
    // Наступний набір рахуємо тут, а не в оновлювачі стану: писати в
    // localStorage усередині нього не можна — React має право покликати
    // його двічі.
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setHidden(next);
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      // Не зберегли — не біда: у цій сесії фільтр однаково працює.
    }
  };

  const inScope = (data?.clients ?? [])
    .filter((c) => scope === "all" || c.mine !== false)
    // Чужому клієнту точку можна поставити, лише поки вона здогад геокодера:
    // пересувати те, що вже уточнила людина, сервер не дасть (403), тож і
    // кнопки бути не повинно.
    .map((c) => ({ ...c, canPin: c.mine !== false || c.approximate }));
  const visible = inScope.filter((c) => !hidden.has(c.state));

  /**
   * Лічильники легенди — за поточним зрізом, а не за всією відповіддю.
   * Інакше в режимі «Мої» бейдж каже «Активні 210», а на карті їх 40.
   */
  /**
   * Кому ставимо точку — по ВСІЙ базі, а не лише серед тих, кого на карті
   * немає.
   *
   * Спершу тут був список самих «без точки», і це відповідало не на те
   * питання. Торговий сідає ввечері й розставляє точки по пам'яті — а
   * найчастіше не ставить нову, а виправляє приблизну: таких 3 015 із
   * 3 042, бо геокодер знає лише місто. Шукаючи «Струк Ольга», він її не
   * знаходив саме тому, що вона на карті вже є, — і робив висновок, що в
   * цьому списку взагалі інші клієнти.
   *
   * Порядок відповідає роботі: спершу ті, кого на карті немає, далі
   * приблизні, наприкінці вже уточнені. Всередині кожної групи свої вгорі.
   *
   * `canPin` повторює правило сервера (PATCH /api/admin/client-map/[id]):
   * чужому клієнту точку можна ПОСТАВИТИ, поки вона здогад геокодера, і не
   * можна ПЕРЕСУНУТИ ту, яку вже уточнила людина. Рядок, який гарантовано
   * поверне 403, показуємо, але не даємо тапнути — інакше єдиною відповіддю
   * була б помилка вже після вибору.
   */
  const placeable: Array<{
    id: string;
    name: string;
    address: string | null;
    mine: boolean;
    /** 0 — немає точки, 1 — приблизна, 2 — уточнена людиною. */
    rank: 0 | 1 | 2;
    canPin: boolean;
  }> = [
    ...(data?.unmapped ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      address: u.address,
      mine: u.mine !== false,
      rank: 0 as const,
      // Піна немає взагалі — поставити може будь-хто зі своїх ролей.
      canPin: true,
    })),
    ...(data?.clients ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address,
      mine: c.mine !== false,
      rank: (c.approximate ? 1 : 2) as 1 | 2,
      canPin: c.mine !== false || c.approximate,
    })),
  ];

  const addQ = addQuery.trim().toLowerCase();
  const toPlace = placeable
    .filter(
      (p) =>
        !addQ || p.name.toLowerCase().includes(addQ) || (p.address ?? "").toLowerCase().includes(addQ)
    )
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.mine) - Number(a.mine) ||
        a.name.localeCompare(b.name, "uk")
    )
    // Ріжемо до 60 — далі гортання втрачає сенс, для цього є пошук.
    .slice(0, 60);

  const counts = inScope.reduce<Record<string, number>>((acc, c) => {
    acc[c.state] = (acc[c.state] ?? 0) + 1;
    return acc;
  }, {});
  const approximateCount = inScope.filter((c) => c.approximate).length;
  /**
   * Скільки точок зараз не показано. Виводимо у ЗГОРНУТІЙ смужці: легенда
   * з перемикачами лежить усередині, і без цього числа «Нові» просто
   * зникли б мовчки — карта виглядала б так, ніби клієнтів стало менше.
   */
  const hiddenCount = LEGEND.reduce((sum, k) => (hidden.has(k) ? sum + (counts[k] ?? 0) : sum), 0);

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
          extras={{ clientCardHref: "/sales/clients/", pin: true, comments: true }}
          onAction={(a) => {
            const c = data?.clients.find((x) => x.id === a.id);
            if (!c) return;
            if (a.kind === "pin") {
              setPinError(null);
              setPinFor({ id: c.id, name: c.name });
              return;
            }
            if (a.kind === "comments") {
              setNotesFor({ id: c.id, name: c.name });
              return;
            }
            setOrderFor({ id: c.id, name: c.name, state: c.state });
          }}
        />
      </div>

      {/* Шапка поверх карти: назад і маршрут дня */}
      <div
        className="absolute inset-x-0 top-0 z-[500] px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)",
          paddingBottom: "10px",
          background: "linear-gradient(#F7F7F7EE, #F7F7F700)",
        }}
      >
        <div className="flex items-center gap-2">
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
                Нічого не знайдено серед клієнтів компанії.
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
        {/* Поставити точку клієнту, якого ще немає на карті. Окрема кнопка,
            бо доти цей шлях був схований у пошуку: щоб поставити пін, треба
            було здогадатися шукати клієнта, якого на карті не видно. */}
        <button
          type="button"
          onClick={() => {
            setAddQuery("");
            setAddOpen(true);
          }}
          aria-label="Поставити точку клієнту"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.15)", border: "none" }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={1.9}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
            />
          </svg>
        </button>

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

        {/* Обсяг карти. Окремим рядом під керуванням: у портреті телефона
            два сегменти поруч із пошуком не влазять. Той самий елемент, що
            в карті водія, — щоб перехід між кабінетами нічого не переучував. */}
        {data && (
          <div
            className="mt-2 flex gap-1 rounded-full p-1"
            style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.12)" }}
          >
            {(
              [
                { key: "mine", label: "Мої", n: data.mineCount },
                { key: "all", label: "Всі", n: data.clients.length },
              ] as Array<{ key: Scope; label: string; n: number }>
            ).map((sc) => {
              const on = scope === sc.key;
              return (
                <button
                  key={sc.key}
                  type="button"
                  onClick={() => setScope(sc.key)}
                  aria-pressed={on}
                  className="flex-1 cursor-pointer rounded-full transition-colors duration-200"
                  style={{
                    minHeight: "40px",
                    border: "none",
                    background: on ? "#0A0A0A" : "transparent",
                    color: on ? "#fff" : "#374151",
                    fontSize: "13px",
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {sc.label}{" "}
                  <span style={{ color: on ? "rgba(255,255,255,0.65)" : "#9CA3AF", fontWeight: 400 }}>
                    {sc.n}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div
          className="absolute inset-x-3 z-[500] rounded-xl p-3"
          style={{ top: "118px", background: "#FEF2F2", border: "1px solid #FECACA" }}
        >
          <p style={{ fontSize: "13px", color: "#B91C1C" }}>{error}</p>
        </div>
      )}

      {/* Хто ще не стоїть на карті. Список, а не пошук наосліп: торговий
          частіше згадує «когось із цих ще не позначив», ніж прізвище. Свої
          вгорі — з них і починають. */}
      {addOpen && (
        <>
          {/*
            Підкладка на весь екран: тап повз панель закриває її.
            Без неї єдиним виходом лишалася сіра напис-кнопка «Закрити»
            поруч із полем, і з відкритою клавіатурою на планшеті людина її
            просто не знаходила — панель ставала пасткою, з якої виходили
            через нижнє меню.
          */}
          <div
            className="absolute inset-0 z-[640]"
            onClick={() => setAddOpen(false)}
            aria-hidden
          />
          <div
            className="absolute inset-x-3 z-[650] flex flex-col rounded-2xl"
            style={{
              top: "110px",
              maxHeight: "62vh",
              background: "#fff",
              boxShadow: "0 8px 26px rgba(0,0,0,0.22)",
              overflow: "hidden",
            }}
          >
          <div className="flex items-center gap-2 px-3 pt-3">
            <input
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="Кому ставимо точку?"
              aria-label="Пошук клієнта"
              autoFocus
              className="min-w-0 flex-1 rounded-full px-3.5 py-2"
              style={{
                background: "#F3F4F6",
                border: "none",
                fontSize: "16px", // нижче 16px iOS зумить сторінку при фокусі
                color: "#0A0A0A",
                outline: "none",
              }}
            />
            {/* Хрестик, а не напис: 44 px цілі дотику й упізнаваний знак —
                його шукають очима першим, коли треба вийти. */}
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              aria-label="Закрити пошук"
              className="flex shrink-0 items-center justify-center rounded-full"
              style={{
                width: "44px",
                height: "44px",
                background: "#F3F4F6",
                border: "none",
                color: "#0A0A0A",
                fontSize: "18px",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          <p style={{ fontSize: "11px", color: "#9CA3AF", margin: "6px 12px 4px", lineHeight: 1.4 }}>
            Будь-який клієнт бази, не лише ті, кого немає на карті. Оберіть — далі тапніть
            місце на карті або натисніть «Я зараз тут», якщо ви вже на місці.
          </p>

          <ul
            className="min-h-0 flex-1 overflow-y-auto"
            style={{ listStyle: "none", margin: 0, padding: "0 0 8px" }}
          >
            {toPlace.length === 0 ? (
              <li style={{ padding: "10px 12px", fontSize: "13px", color: "#9CA3AF" }}>
                {addQuery.trim() ? "Нікого не знайдено в базі." : "База порожня."}
              </li>
            ) : (
              toPlace.map((u) => {
                // Що зараз із точкою — видно ще до вибору, інакше незрозуміло,
                // ставимо ми нову чи пересуваємо чиюсь.
                const mark =
                  u.rank === 0
                    ? { text: "немає на карті", color: "#D97706" }
                    : u.rank === 1
                      ? { text: "точка приблизна", color: "#D97706" }
                      : u.canPin
                        ? { text: "точка уточнена", color: "#059669" }
                        : { text: "уточнив інший", color: "#9CA3AF" };
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      disabled={!u.canPin}
                      onClick={() => {
                        setAddOpen(false);
                        setPinError(null);
                        setPinFor({ id: u.id, name: u.name });
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                      style={{
                        background: "none",
                        border: "none",
                        opacity: u.canPin ? 1 : 0.5,
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate"
                          style={{ fontSize: "14px", color: "#0A0A0A" }}
                        >
                          {u.name}
                        </span>
                        <span
                          className="block truncate"
                          style={{ fontSize: "11px", color: "#9CA3AF" }}
                        >
                          <span style={{ color: mark.color }}>{mark.text}</span>
                          {u.address ? ` · ${u.address}` : ""}
                        </span>
                      </span>
                      {u.mine && (
                        <span className="shrink-0" style={{ fontSize: "11px", color: "#2563EB" }}>
                          ваш
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          </div>
        </>
      )}

      {/* Постановка піна: панель угорі, щоб не закривати карту знизу, де
          зазвичай і цілять пальцем. */}
      {pinFor && (
        <div
          className="absolute inset-x-3 z-[600] rounded-2xl p-3"
          style={{ top: "110px", background: "#0A0A0A", boxShadow: "0 6px 20px rgba(0,0,0,0.3)" }}
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
              {/* Першим — те, що людина може ввімкнути назад: інакше
                  «нових» не знайде ніхто, а вони просто сховані. */}
              {hiddenCount > 0 && (
                <span style={{ fontSize: "12px", fontWeight: 600, color: "#2a78d6" }}>
                  {hiddenCount} приховано
                </span>
              )}
              {approximateCount > 0 && (
                <span style={{ fontSize: "12px", color: "#D97706" }}>
                  ⌖ {approximateCount} приблизних
                </span>
              )}
              {data.unmapped.length > 0 && (
                <span style={{ fontSize: "12px", color: "#9CA3AF" }}>
                  {data.unmapped.length} без точки
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

            {/*
              «Нові» показані — прибрати в один тап, не відкриваючи легенду.
              З'являється тільки коли вони справді на екрані. Легенда лежить
              усередині згорнутої панелі, і поки до неї дійдеш, стіна синього
              вже заважає — а це саме те, на що скаржаться найгучніше.
            */}
            {!hidden.has("NEW") && (counts.NEW ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => toggle("NEW")}
                className="flex w-full items-center gap-2 px-4 py-2.5"
                style={{ background: "none", border: "none", borderTop: "1px solid #F0F0F0" }}
              >
                <span
                  aria-hidden
                  style={{
                    width: "9px",
                    height: "9px",
                    borderRadius: "50%",
                    background: CLIENT_STATE.NEW.color,
                  }}
                />
                <span style={{ fontSize: "13px", color: "#0A0A0A" }}>
                  Сховати «Нових» ({counts.NEW})
                </span>
                <span style={{ marginLeft: "auto", fontSize: "11px", color: "#9CA3AF" }}>
                  перекривають решту
                </span>
              </button>
            )}

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
                    const n = counts[k] ?? 0;
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
                  Дрібні бліді точки — клієнти компанії, не закріплені за вами.
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

      {/* Нотатки й фото локації. Після збереження перечитуємо карту: точка
          мусить одразу показати щойно зняті ворота. */}
      {notesFor && (
        <ClientCommentsModal
          key={notesFor.id}
          client={notesFor}
          onClose={() => setNotesFor(null)}
          onSaved={() => {
            // Тут перезапит потрібен: у відповіді нема ні щойно знятого
            // фото, ні нового лічильника нотаток — їх знає лише сервер.
            void mutate();
          }}
        />
      )}
    </div>
  );
}
