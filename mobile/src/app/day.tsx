/**
 * День водія: точки маршруту, відмітки, каса.
 *
 * Перший екран кабінету, переписаний нативно, і саме цей — не за красу. У
 * WebView відмітка без зв'язку просто падала: водій стояв біля магазину,
 * тикав «Виконано», бачив помилку і їхав далі — точка лишалася невідміченою,
 * а ввечері день не сходився ні за адресами, ні за грошима. Тут відмітка
 * лягає в чергу на пристрої й показується виконаною одразу.
 *
 * Карти немає навмисно — рішення власника від 25.08: дорогу водій дивиться в
 * Google Maps, а сюди ходить відмічатися. Посилання будуються від поточної
 * позиції через ще НЕ відмічені точки: везти людину туди, де вона вже була,
 * немає сенсу.
 *
 * Верстка з макета (~/Desktop/pencil-sales.pen, ряд «водій»). Головне рішення
 * там — точки не картками, а суцільним списком на всю ширину: водій гортає їх
 * весь день однією рукою, і поля між картками з'їдали б третину екрана. Стан
 * точки видно кольором смуги ще до того, як прочитано назву.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  AppState,
  FlatList,
  Linking,
  RefreshControl,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { staffApi, type DayResponse, type DayStop } from "@/api/staff";
import { useDay, useDriverRoutes, refetchIfStale } from "@/api/staff-queries";
import { formatUAH } from "@/theme";
import { c, r, sp } from "@/ui/tokens";
import { Icon } from "@/ui/Icon";
import {
  Body,
  Button,
  ButtonRow,
  Callout,
  Card,
  CardTitle,
  Eyebrow,
  Field,
  GoldLine,
  Note,
  TextLink,
} from "@/ui/kit";
import { DriverTabBar } from "@/ui/DriverTabBar";
import { UpdateBar } from "@/ui/UpdateBar";
import { bufferedCount } from "@/track/db";
import { isTracking } from "@/track/controller";
import { listPendingVisits, queueVisit, type PendingVisit } from "@/track/pending-visits";
import {
  batchNavigateUrl,
  googleMapsLinksFromHere,
  navIntentUrl,
  pointUrl,
  type NavApp,
} from "@/lib/google-links";
import {
  NAV_BATCHES,
  getAutoNext,
  getNavApp,
  getNavBatch,
  setAutoNext,
  setNavApp,
  setNavBatch,
  type NavBatch,
} from "@/lib/nav-app";
import { haversineM } from "@/lib/geo";
import { within, PROBE_MS } from "@/lib/within";
import { formatRouteDay, formatTime, kyivToday } from "@/lib/format-date";
import { RoutePickerSheet } from "@/ui/RoutePickerSheet";

type Money = "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";

/** Стільки НЕнадісланих точок уже означає не паузу між пачками, а тишу мережі. */
const OFFLINE_POINTS = 20;

/**
 * Ближче за це — водій уже приїхав.
 *
 * Сто п'ятдесят метрів — це двір і сусідній під'їзд, але вже не сусідній
 * квартал; та сама межа, за якою трек підписує зупинку клієнтом
 * (сервер, lib/track/stops.ts). Ширше — і підказка спрацьовувала б на
 * проїзді повз.
 */
const ARRIVE_M = 150;

/**
 * Наскільки старим може бути фікс, щоб на нього спиратися.
 *
 * Дві хвилини: за цей час машина проїде кілометри, а підказка «ви на
 * місці» на застарілій координаті — це відмітка не в того клієнта.
 */
const POS_MAX_AGE_MS = 120_000;

export default function DayScreen() {
  const insets = useSafeAreaInsets();
  /**
   * День — з кеша запитів; черга, трек і буфер — завжди з пристрою.
   *
   * Водій відкриває цей екран десятки разів на добу, і щоразу він читався
   * наново. Тепер маршрут малюється миттєво з відомого, а сервер підтверджує
   * його під уже намальованим списком. Віддача черги лишилася в самому запиті —
   * порядок «спершу черга, потім день» від цього не змінився.
   */
  /**
   * Який день відкрито. Порожньо — сьогоднішній.
   *
   * Ключ листа приходить із кабінету (карта, список маршрутів, історія) і
   * сильніший за дату: на одну добу листів буває два.
   */
  const params = useLocalSearchParams<{ route?: string; day?: string }>();
  const openedRoute = typeof params.route === "string" ? params.route : undefined;
  const openedDay = openedRoute ? undefined : typeof params.day === "string" ? params.day : undefined;
  const router = useRouter();

  const query = useDay({ route: openedRoute, day: openedDay });
  const data = query.data ?? null;
  const error = query.isError;

  // Свіжий стан запиту для ефекту фокуса — читаємо його вже після рендера.
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  const [queued, setQueued] = useState<PendingVisit[]>([]);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [navApp, setNav] = useState<NavApp>("google");
  const [batch, setBatch] = useState<NavBatch>(1);
  const [autoNext, setAuto] = useState(true);
  const [showWholeRoute, setShowWholeRoute] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Точка, для якої водій уже сказав «ще ні» на підказці прибуття. */
  const [dismissedArrival, setDismissedArrival] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getNavApp().then((app) => alive && setNav(app));
    void getNavBatch().then((n) => alive && setBatch(n));
    void getAutoNext().then((v) => alive && setAuto(v));
    return () => {
      alive = false;
    };
  }, []);

  const chooseNav = useCallback((app: NavApp) => {
    setNav(app);
    void setNavApp(app);
  }, []);

  const chooseBatch = useCallback((n: NavBatch) => {
    setBatch(n);
    void setNavBatch(n);
  }, []);

  const chooseAutoNext = useCallback((on: boolean) => {
    setAuto(on);
    void setAutoNext(on);
  }, []);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [buffered, setBuffered] = useState(0);
  /** Локальні проби ще жодного разу не відповідали. */
  const [probed, setProbed] = useState(false);

  /** Список листів тягнеться лише поки шторка відкрита. */
  const routesQuery = useDriverRoutes(pickerOpen);

  /**
   * Обрали інший лист — міняємо адресу екрана, а не стан.
   *
   * `replace`, щоб «назад» не гортало історію листів; ключ у параметрах
   * переживає згортання застосунку, а `useDay` бере його в ключ кеша.
   */
  const pickRoute = useCallback(
    (key: string | null) => {
      setPickerOpen(false);
      setOpenKey(null);
      setDismissedArrival(null);
      router.replace(key ? { pathname: "/day", params: { route: key } } : "/day");
    },
    [router]
  );

  /**
   * Стан пристрою: що лишилося в черзі, чи пишеться трек, скільки точок у
   * буфері. Кожна проба з межею очікування — збій чи затримка SQLite або служби
   * локації не має лишати водія на вертушці.
   */
  const refreshLocal = useCallback(async () => {
    setQueued(await within(listPendingVisits(), PROBE_MS, [] as PendingVisit[]));
    setTracking(await within(isTracking(), PROBE_MS, false));
    setBuffered(await within(bufferedCount(), PROBE_MS, 0));
    setProbed(true);
  }, []);

  /**
   * Оновити все: спершу день, потім стан пристрою.
   *
   * Порядок тут не косметичний. Запит віддає чергу серверу перед тим, як
   * спитати день, тож читати чергу до його завершення означає показати
   * пісочний годинник поверх відмітки, яка вже поїхала.
   */
  const load = useCallback(async () => {
    await queryRef.current.refetch();
    await refreshLocal();
  }, [refreshLocal]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        await refetchIfStale(queryRef.current);
        if (alive) await refreshLocal();
      })();
      Location.getLastKnownPositionAsync({ maxAge: POS_MAX_AGE_MS })
        .then((p) => p && setPos({ lat: p.coords.latitude, lng: p.coords.longitude }))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [refreshLocal])
  );

  /**
   * Повернення із застосунку навігації фокус НЕ ловить.
   *
   * Google Maps не забирає екран у React Navigation — він забирає його в
   * усього застосунку, і на вихід та повернення реагує лише AppState. Без
   * цього після поїздки лишалася б координата, зафіксована ще до виїзду, і
   * підказка «ви на місці» не спрацювала б жодного разу — тобто рівно
   * тоді, коли вона потрібна.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      Location.getLastKnownPositionAsync({ maxAge: POS_MAX_AGE_MS })
        .then((p) => p && setPos({ lat: p.coords.latitude, lng: p.coords.longitude }))
        .catch(() => {});
      void refetchIfStale(queryRef.current);
    });
    return () => sub.remove();
  }, []);

  const stops = useMemo(() => data?.route?.stops ?? [], [data?.route?.stops]);

  /**
   * Відкритий день не сьогоднішній — відмітки лише читаються.
   *
   * Кнопка «Приїхав» пише візит у ТУ добу, яка відкрита на екрані. Водій,
   * що зайшов подивитися вчорашній лист і забув повернутися, датував би
   * сьогоднішні доставки вчора, і помітили б це аж на розрахунку.
   *
   * Дорога при цьому лишається: «поїхати» нічого не змінює, і забороняти
   * її разом із відмітками — саме та вада, через яку водій на тесті не міг
   * побудувати маршрут по завтрашньому листу.
   */
  const notToday = !!data?.day && data.day !== kyivToday();
  /**
   * Відкрито лист колеги.
   *
   * Дивитися й будувати дорогу по ньому можна — заради цього листи всіх і
   * показуються, — а відмічати ні: візит належить тому, хто його поставив,
   * і дві відмітки одного клієнта від двох водіїв розсипали б і прогрес
   * маршруту, і зарплату. Сервер це теж не приймає (/api/visits), тут — щоб
   * людина не тиснула кнопку, яка однаково відмовить.
   */
  const foreign = !!data?.route && data.route.source !== "NONE" && data.route.mine === false;
  const readOnly = notToday || foreign;
  const queuedKeys = useMemo(() => new Set(queued.map((q) => q.stopKey)), [queued]);

  /** Відмічена — це або відмітка з сервера, або та, що чекає в черзі. */
  const isMarked = useCallback(
    (s: DayStop) => !!s.visit || queuedKeys.has(s.key),
    [queuedKeys]
  );

  /**
   * Дорога починається там, де водій зараз, — і це вирішує Google, а не ми.
   *
   * Тут стояла остання відома координата з нативного трека. У машині вона
   * застаріває швидше, ніж людина встигає натиснути кнопку, а коли фікса
   * ще не було, маршрут починався з ПЕРШОЇ ТОЧКИ — тобто Google вів так,
   * ніби водій уже стоїть у Миколаєві. Без origin Google сам підставляє
   * живе «Ваше місцезнаходження».
   */
  const mapLinks = useMemo(() => {
    const pending = stops
      .filter((s) => !isMarked(s) && s.lat != null && s.lng != null)
      .map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
    return googleMapsLinksFromHere(pending);
  }, [stops, isMarked]);

  /**
   * Точка, куди водій їде ЗАРАЗ — перша невідмічена за порядком обʼїзду.
   *
   * Вона й замінила «дорогу частинами»: коли ведеш по одній точці, ліміт
   * Google ні до чого прикласти, а наступну підставляє сам застосунок,
   * щойно попередню відмічено.
   */
  /**
   * Найближчі невідмічені точки за порядком обʼїзду.
   *
   * Не одна: водій сам обирає, скільки зарядити в навігатор — одну, три чи
   * пʼять. Одна це «веди мене туди», пʼять — погляд на найближчу годину.
   */
  const pending = useMemo(
    () => stops.filter((st) => !isMarked(st) && st.lat != null && st.lng != null),
    [stops, isMarked]
  );

  // Waze веде до однієї точки — пачка для нього завжди одна.
  const take = navApp === "waze" ? 1 : batch;
  const chunk = useMemo(() => pending.slice(0, take), [pending, take]);

  /**
   * Водій уже на місці — питаємо, чи відмічати.
   *
   * Без цього шлях такий: вилізти з кабіни, розблокувати планшет, знайти
   * потрібний рядок серед тридцяти, розгорнути, натиснути. Кожен крок — під
   * дощем і з коробкою в руках, і саме тому відмітки часто ставили ввечері
   * пачкою, коли вже нічого не пам'ятаєш.
   *
   * Пін «до міста» сюди не пускаємо: у такого клієнта координата — центр
   * села, і сто п'ятдесят метрів від неї не значать нічого. Краще мовчати,
   * ніж питати «ви на місці?» за кілометр від воріт.
   */
  const arrival = useMemo(() => {
    if (readOnly || !pos) return null;
    const head = pending[0];
    if (!head || head.key === dismissedArrival) return null;
    if (head.kind === "DELIVERY" && !head.counterpartyId) return null;
    if (head.geoSource === "CITY") return null;
    const m = haversineM(pos.lat, pos.lng, head.lat as number, head.lng as number);
    return m <= ARRIVE_M ? head : null;
  }, [readOnly, pos, pending, dismissedArrival]);

  /**
   * Поїхали до цих точок.
   *
   * Для однієї точки в Google спершу пробуємо намір `google.navigation:` —
   * він запускає покрокову навігацію без екрана «Почати». Не вийшло (немає
   * Google Maps, інша прошивка) — відкриваємо звичайне посилання, як і
   * досі. Пачка з кількох точок наміром не їде: схема приймає лише одну.
   *
   * Приймає пачку аргументом, а не бере з екрана: після відмітки вести
   * треба вже до НАСТУПНОЇ, а стан на цю мить ще старий.
   */
  const openNav = useCallback(
    async (points: DayStop[]) => {
      const coords = points
        .filter((st) => st.lat != null && st.lng != null)
        .map((st) => ({ lat: st.lat as number, lng: st.lng as number }));
      const url = batchNavigateUrl(coords, navApp);
      if (!url) return;
      if (navApp === "google" && coords.length === 1) {
        try {
          await Linking.openURL(navIntentUrl(coords[0]));
          return;
        } catch {
          // Падаємо на звичайне посилання нижче.
        }
      }
      void Linking.openURL(url);
    },
    [navApp]
  );

  const drive = useCallback(() => void openNav(chunk), [openNav, chunk]);

  const mark = useCallback(
    async (
      stop: DayStop,
      status: "DONE" | "MISSED",
      money: Money,
      extra?: { collectedAmount?: number; comment?: string }
    ) => {
      const isErrand = stop.kind !== "DELIVERY";
      if (!isErrand && !stop.counterpartyId) return;

      const entry: PendingVisit = isErrand
        ? {
            stopKey: stop.key,
            kind: "errand",
            errandStopId: stop.deliveryStopId ?? stop.key.slice(3),
            errandStatus: status === "DONE" ? "DELIVERED" : "FAILED",
            comment: extra?.comment,
            createdAt: Date.now(),
          }
        : {
            stopKey: stop.key,
            kind: "visit",
            visit: {
              counterpartyId: stop.counterpartyId as string,
              status,
              money,
              debtAmount: stop.debtAmount,
              collectedAmount: extra?.collectedAmount ?? null,
              comment: extra?.comment ?? null,
              routeSheetStopId: stop.routeSheetStopId,
              deliveryStopId: stop.deliveryStopId,
              // Де стояв планшет у мить відмітки — доказ присутності.
              lat: pos?.lat ?? null,
              lng: pos?.lng ?? null,
            },
            createdAt: Date.now(),
          };

      /**
       * Куди вести далі — рахуємо ДО збереження.
       *
       * Саме це й знімає ліміт Google на девʼять проміжних точок: наступну
       * пачку підставляє застосунок, і водієві не треба повертатися сюди й
       * тиснути «Їхати». Порядок точок беремо той самий, що на екрані,
       * мінус щойно відмічена: закрити могли не першу, і вести треба туди,
       * куди водій і збирався.
       */
      const next =
        autoNext && !readOnly ? pending.filter((st) => st.key !== stop.key).slice(0, take) : [];

      /**
       * Спершу в чергу, потім спроба надіслати.
       *
       * Такий порядок означає, що відмітка не губиться навіть тоді, коли
       * застосунок закриють одразу після натискання.
       */
      await queueVisit(entry);
      setQueued(await listPendingVisits());
      setOpenKey(null);
      setDismissedArrival(null);
      // Навігатор відкриваємо ДО перечитування дня: чекати на мережу, поки
      // машина стоїть із увімкненою аварійкою, немає за що.
      if (next.length > 0) void openNav(next);
      await load();
    },
    [pos, load, autoNext, readOnly, pending, take, openNav]
  );

  if (query.isPending) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.bk} />
      </View>
    );
  }

  const p = data?.progress;
  const cash = data?.cash;
  const offline = buffered >= OFFLINE_POINTS;

  /**
   * Усе, що стоїть над списком точок. Тримається окремо, бо список тепер
   * віртуалізований: за довгий день у ньому шість десятків рядків, і малювати
   * їх усі одразу — це секунда чорного екрана на планшеті водія.
   */
  const header = (
    <>
      {/*
        «Ви на місці» — перше, що бачить водій, який щойно зупинився.
        Вище черги й вище банерів: він дивиться на планшет секунду, з
        коробкою в руках.
      */}
      {arrival && (
        <View style={[s.block, s.headBlock]}>
          <Callout tone="good" icon="flag" title={`Ви біля ${arrival.name}`}>
            <ButtonRow>
              <Button
                label={
                  arrival.kind !== "DELIVERY"
                    ? "Виконано"
                    : arrival.debtAmount > 0
                      ? `Приїхав, забрав ${formatUAH(arrival.debtAmount)}`
                      : "Приїхав"
                }
                onPress={() =>
                  void mark(arrival, "DONE", arrival.debtAmount > 0 ? "FULL" : "NONE")
                }
              />
              <Button
                tone="outline"
                label={arrival.kind !== "DELIVERY" ? "Не вийшло" : "Не потрапив"}
                onPress={() => void mark(arrival, "MISSED", "NOT_APPLICABLE")}
              />
            </ButtonRow>
            <TextLink
              label="Ще ні — я тільки під'їхав"
              onPress={() => setDismissedArrival(arrival.key)}
            />
          </Callout>
        </View>
      )}

      {/*
        Лист колеги. Дивитися й будувати дорогу можна, відмічати — ні.
      */}
      {foreign && (
        <View style={[s.block, s.headBlock]}>
          <Callout
            tone="warn"
            icon="user"
            title={`Лист ${data?.route?.driverName ?? "іншого водія"}`}
            action={{ label: "До свого маршруту", onPress: () => router.replace("/day") }}
          >
            Переглянути й побудувати дорогу можна. Відмічати точки і здавати касу може лише він.
          </Callout>
        </View>
      )}

      {queued.length > 0 && (
        <View style={[s.section, s.headBlock]}>
          <Card tone="brand" style={s.queueCard} gap={sp.xxs}>
            <View style={s.queueRow}>
              <Icon name="cloud-off" size={22} color={c.warn} />
              <View style={s.queueText}>
                <CardTitle>Чекає на мережу: {queued.length}</CardTitle>
                <Note>
                  Відмітки збережено на пристрої й показано як виконані. Надішлемо самі — тикати
                  ще раз не треба.
                  {buffered > 0 ? ` Трек теж у буфері: ${buffered} точок.` : ""}
                </Note>
              </View>
            </View>
          </Card>
        </View>
      )}

      {error && !data && (
        <View style={[s.section, s.headBlock]}>
          <Card tone="warn">
            <CardTitle>Немає зв’язку</CardTitle>
            <Body>
              День не завантажився. Маршрут і трек від цього не залежать — запис іде далі.
            </Body>
          </Card>
        </View>
      )}

      {/*
        Смуга дня, який не сьогодні. Під шапкою, а не всередині списку:
        водій має побачити її раніше, ніж дотягнеться до першої точки.
      */}
      {notToday && (
        <View style={[s.block, s.headBlock]}>
          <Callout tone="info" icon="clock" title={`Маршрут за ${data?.day ?? "інший день"}`}>
            Це лише перегляд: відмітити точки можна тільки в поточному дні, минуле виправляє офіс.
            Дорогу побудувати можна — кнопка нижче працює.
          </Callout>
          <Button tone="outline" label="До сьогоднішнього маршруту" onPress={() => router.replace("/day")} />
        </View>
      )}

      {/*
        Куди їхати просто зараз — і на скільки точок наперед.

        Замість «дороги частинами», яка була наслідком чужого обмеження:
        посилання Google бере щонайбільше девʼять проміжних точок, тож день
        на 25 адрес різався на три шматки, і між ними водій мусив САМ
        згадати, що треба повернутися сюди й відкрити наступний. За кермом
        про це не згадують.

        Тепер розмір пачки обирає водій: одна точка, три або пʼять. Наступну
        пачку підставляє застосунок, коли попередні відмічено.

        Waze приймає рівно одну точку, тому з ним вибір пачки не показуємо.
      */}
      {pending.length > 0 && (
        <View style={[s.block, s.headBlock]}>
          <View style={s.nextHead}>
            <Eyebrow>{take > 1 ? "Наступні точки" : "Наступна точка"}</Eyebrow>
            {/* Скільки лишиться ПІСЛЯ цієї пачки: «ще 32», коли попереду
                рівно 32 разом із поточними, читається як помилка в рахунку. */}
            <Text style={s.nextLeft}>
              {(p?.left ?? 0) > chunk.length ? `далі ще ${p!.left - chunk.length}` : "останні"}
            </Text>
            {/* Вибір навігатора тут, а не в налаштуваннях: його міняють раз у
                житті, але саме тоді, коли вперше тиснуть «Їхати». */}
            <View style={s.navPick}>
              {(["google", "waze"] as NavApp[]).map((app) => (
                <Pressable
                  key={app}
                  onPress={() => chooseNav(app)}
                  accessibilityState={{ selected: navApp === app }}
                  style={[s.navPickItem, navApp === app && s.navPickItemOn]}
                >
                  <Text style={[s.navPickLabel, navApp === app && s.navPickLabelOn]}>
                    {app === "google" ? "Google" : "Waze"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Скільки точок заряджаємо. Ховаємо, коли їх однаково менше двох:
              вибір «1 / 3 / 5» на останній точці дня нічого не міняє. */}
          {navApp === "google" && pending.length > 1 && (
            <View style={s.batchRow}>
              <Text style={s.batchLabel}>Скільки точок:</Text>
              <View style={s.navPick}>
                {NAV_BATCHES.filter((n) => n === 1 || n <= pending.length).map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => chooseBatch(n)}
                    accessibilityState={{ selected: batch === n }}
                    style={[s.navPickItem, batch === n && s.navPickItemOn]}
                  >
                    <Text style={[s.navPickLabel, batch === n && s.navPickLabelOn]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/*
            Автоперехід — тут, а не в налаштуваннях: він міняє те, що
            станеться одразу після наступної відмітки, і рішення про нього
            приймають саме в цю мить. У читальному режимі не показуємо:
            відміток там немає, отже й переходити нема від чого.
          */}
          {!readOnly && (
            <Pressable
              onPress={() => chooseAutoNext(!autoNext)}
              accessibilityRole="switch"
              accessibilityState={{ checked: autoNext }}
              style={s.autoRow}
            >
              <View style={[s.autoBox, autoNext && s.autoBoxOn]}>
                {autoNext && <Icon name="check" size={13} color={c.brand} />}
              </View>
              <Text style={[s.autoLabel, autoNext && s.autoLabelOn]}>
                Після відмітки — одразу вести далі
              </Text>
            </Pressable>
          )}

          {/* Що саме поїде в навігатор: водій бачить пачку списком ДО того,
              як відкрив Google, і встигає зрозуміти, що маршрут веде не туди. */}
          {chunk.map((st, i) => (
            <View key={st.key} style={s.nextRow}>
              <View style={[s.nextNum, i === 0 && s.nextNumFirst]}>
                <Text style={[s.nextNumLabel, i === 0 && s.nextNumLabelFirst]}>{i + 1}</Text>
              </View>
              <View style={s.nextRowBody}>
                <Text style={i === 0 ? s.nextName : s.nextNameSmall} numberOfLines={2}>
                  {st.name}
                </Text>
                {!!st.address && (
                  <Text style={s.nextAddress} numberOfLines={1}>
                    {st.address}
                  </Text>
                )}
              </View>
            </View>
          ))}

          <Pressable
            style={[s.mapLink, s.mapLinkPrimary]}
            onPress={() => void drive()}
          >
            <Icon name="navigation" size={16} color={c.onDark} />
            <Text style={[s.mapLinkLabel, { color: c.onDark }]}>
              {chunk.length > 1
                ? `Їхати · ${chunk.length} точок`
                : `Їхати в ${navApp === "waze" ? "Waze" : "Google Maps"}`}
            </Text>
          </Pressable>

          <Note>
            {navApp === "waze"
              ? "Waze веде до однієї точки за раз. Дорога почнеться там, де ви зараз."
              : "Дорога почнеться там, де ви зараз. Відмітили точки — тут зʼявляться наступні."}
          </Note>

          {mapLinks.length > 0 && (
            <>
              <Pressable onPress={() => setShowWholeRoute((v) => !v)} style={s.wholeToggle}>
                <Text style={s.wholeToggleLabel}>
                  {showWholeRoute ? "Сховати" : "Завантажити весь маршрут частинами"}
                </Text>
              </Pressable>

              {showWholeRoute && (
                <View style={s.mapLinks}>
                  {mapLinks.map((l, i) => (
                    <Pressable
                      key={i}
                      style={[s.mapLink, s.mapLinkSecondary]}
                      onPress={() => Linking.openURL(l.url)}
                    >
                      <Text style={[s.mapLinkLabel, { color: c.infoFg }]}>
                        {mapLinks.length > 1 ? `Частина ${i + 1} · ${l.points}` : "Весь маршрут"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      )}
    </>
  );

  const footer = (
    <>
      {stops.length === 0 && !error && (
        <View style={[s.section, s.footBlock]}>
          <Card>
            <CardTitle>На сьогодні точок немає</CardTitle>
            <Body>
              Маршрут складає логіст в адмінці. Якщо ви вже в дорозі — зателефонуйте в офіс.
            </Body>
          </Card>
        </View>
      )}

      {/* Каса — лише на своєму листі: під чужим маршрутом вона показувала б
          мої гроші як гроші того дня, і водій здав би не ту суму. */}
      {cash && !foreign && (
        <View style={s.footBlock}>
          <CashSection cash={cash} day={data?.day} onDone={load} />
        </View>
      )}
    </>
  );

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <DayHeader
        route={data?.route?.number ?? null}
        subtitle={
          data?.day
            ? (foreign ? `${data.route?.driverName ?? "інший водій"} · ` : "") +
              formatRouteDay(data.day, kyivToday())
            : null
        }
        onPressTitle={() => setPickerOpen(true)}
        // Гроші чужого листа не показуємо: на екрані водія будь-яка сума
        // читається як «моя каса».
        progress={p}
        showMoney={!foreign}
        km={data?.track.distanceKm ?? 0}
        tracking={tracking}
        buffered={buffered}
        offline={offline}
        probed={probed}
      />

      <UpdateBar />

      {/*
        Список, а не прокрутка з усіма рядками одразу: у довгий день точок
        шість десятків, кожна з кнопками й полями, і планшет промальовував їх
        усі ще до того, як водій побачив першу.

        Проміжку між елементами тут навмисно немає: рядки точок стикуються
        впритул і розділені власною лінією — відступ розірвав би список на
        окремі картки. Тому поля мають самі шапка й підвал.
      */}
      <FlatList
        data={stops}
        keyExtractor={(st) => st.key}
        extraData={`${openKey ?? ""}|${queued.length}`}
        renderItem={({ item }) => (
          <StopRow
            stop={item}
            queued={queuedKeys.has(item.key)}
            expanded={openKey === item.key}
            readOnly={readOnly}
            onToggle={() => setOpenKey(openKey === item.key ? null : item.key)}
            onMark={mark}
          />
        )}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={[s.list, { paddingBottom: 24 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => {
              load();
            }}
          />
        }
      />

      <RoutePickerSheet
        visible={pickerOpen}
        current={openedRoute ?? data?.route?.id ?? null}
        today={kyivToday()}
        items={routesQuery.data?.items}
        loading={routesQuery.isPending}
        error={routesQuery.isError}
        onPick={pickRoute}
        onClose={() => setPickerOpen(false)}
      />

      <DriverTabBar active="today" />
    </View>
  );
}

/* ---------- Шапка дня ---------- */

/**
 * Чорна шапка з трьома числами: скільки точок пройдено, скільки грошей зібрано
 * і чи пишеться трек.
 *
 * Стан треку саме тут, а не на екрані зміни: водій відкриває «Мій день»
 * десятки разів на добу й жодного разу — «Зміну». Мовчазний трек інакше
 * помічають аж наступного дня, коли пробіг уже не відновити.
 */
function DayHeader({
  route,
  subtitle,
  onPressTitle,
  progress,
  showMoney,
  km,
  tracking,
  buffered,
  offline,
  probed,
}: {
  route: string | null;
  /** День листа, а перед ним ім'я власника, якщо лист чужий. */
  subtitle: string | null;
  onPressTitle: () => void;
  progress: DayResponse["progress"] | undefined;
  /** Чужа каса на своєму екрані — найгірше, що тут можна показати. */
  showMoney: boolean;
  km: number;
  tracking: boolean;
  buffered: number;
  offline: boolean;
  /** Чи встиг пристрій відповісти про трек — до того нічого не стверджуємо. */
  probed: boolean;
}) {
  const insets = useSafeAreaInsets();
  const done = progress?.done ?? 0;
  const missed = progress?.missed ?? 0;
  const total = progress?.total ?? 0;

  /**
   * Поки пристрій не відповів — сірий «перевіряю», а не червоне «Трек не йде».
   *
   * День тепер малюється з кеша ще до того, як служба локації скаже своє, і
   * тривога за замовчуванням спрацьовувала б на кожному відкритті екрана —
   * саме на тому написі, за яким водій судить, чи рахується йому день.
   */
  const dot = !probed ? c.text3 : !tracking ? c.bad : offline ? c.warn : c.good;
  const status = !probed
    ? "перевіряю…"
    : !tracking
      ? "Трек не йде"
      : offline
        ? "Немає звʼязку"
        : "Трек іде";

  return (
    <View style={s.header}>
      <GoldLine />
      <View style={{ height: insets.top }} />
      <View style={s.headerRow}>
        {/*
          Заголовок став кнопкою вибору листа.
          Досі він був простим текстом, і єдиний спосіб відкрити інший
          маршрут із застосунку — піти в карту (тобто у WebView), вибрати
          там і повернутися. Тепер водій тапає по назві просто тут.
        */}
        <Pressable style={s.headerLeft} onPress={onPressTitle} accessibilityRole="button">
          <View style={s.headerTitleRow}>
            <Text style={s.headerTitle} numberOfLines={1}>
              {route ? `Маршрут ${route}` : "Маршрут не складено"}
            </Text>
            <Icon name="chevron-down" size={16} color={c.onDarkMuted} />
          </View>
          {!!subtitle && (
            <Text style={s.headerMuted} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
          {!!progress && (
            <View style={s.headerProgress}>
              <Text style={s.headerMuted}>
                {done + missed} з {total} точок
              </Text>
              {showMoney && (
                <>
                  <Text style={s.headerMuted}> · </Text>
                  <Text style={s.headerMoney}>{formatUAH(progress.collected)}</Text>
                  <Text style={s.headerMuted}> / {formatUAH(progress.debtPlanned)}</Text>
                </>
              )}
            </View>
          )}
        </Pressable>
        <View style={s.headerRight}>
          <View style={s.headerKm}>
            <Text style={s.headerKmValue}>{String(km).replace(".", ",")}</Text>
            <Text style={s.headerMuted}>км</Text>
          </View>
          <View style={s.headerStatus}>
            <View style={[s.statusDot, { backgroundColor: dot }]} />
            <Text style={s.headerStatusLabel}>{status}</Text>
            {buffered > 0 && <Text style={s.headerBuffer}>+{buffered} точок</Text>}
          </View>
        </View>
      </View>

      {/* Смуга під шапкою: зелене — зроблено, червоне — не потрапив. */}
      <View style={s.bar}>
        {total > 0 && <View style={[s.barDone, { flex: done }]} />}
        {total > 0 && <View style={[s.barMissed, { flex: missed }]} />}
        <View style={{ flex: Math.max(0, total - done - missed) || (total ? 0 : 1) }} />
      </View>
    </View>
  );
}

/* ---------- Точка маршруту ---------- */

function StopRow({
  stop,
  queued,
  expanded,
  readOnly,
  onToggle,
  onMark,
}: {
  stop: DayStop;
  queued: boolean;
  expanded: boolean;
  /** Минулий чи завтрашній день: точку видно, відмітити не можна */
  readOnly: boolean;
  onToggle: () => void;
  onMark: (
    s: DayStop,
    status: "DONE" | "MISSED",
    money: Money,
    extra?: { collectedAmount?: number; comment?: string }
  ) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const isErrand = stop.kind !== "DELIVERY";
  const missed = stop.visit?.status === "MISSED";
  const marked = !!stop.visit || queued;

  const tint = queued
    ? c.warnBg
    : missed
      ? c.badBg
      : stop.visit
        ? c.goodBg
        : isErrand
          ? "#FFFDF5"
          : c.surface;

  return (
    <View style={[s.stop, { backgroundColor: tint }]}>
      <Pressable style={s.stopHead} onPress={onToggle}>
        <View
          style={[
            s.badge,
            {
              backgroundColor: queued ? c.warn : missed ? c.bad : stop.visit ? c.good : "#E5E7EB",
            },
          ]}
        >
          {queued ? (
            <Icon name="hourglass" size={16} color={c.onDark} />
          ) : missed ? (
            <Icon name="x" size={18} color={c.onDark} />
          ) : stop.visit ? (
            <Icon name="check" size={18} color={c.onDark} />
          ) : (
            <Text style={s.badgeNum}>{stop.sequence}</Text>
          )}
        </View>

        <View style={s.stopBody}>
          <View style={s.stopNameRow}>
            {isErrand && (
              <View style={s.kind}>
                <Text style={s.kindLabel}>{stop.kind === "PICKUP" ? "ЗАБРАТИ" : "СПРАВА"}</Text>
              </View>
            )}
            <Text style={s.stopName}>{stop.name}</Text>
          </View>
          {!!stop.address && <Text style={s.stopAddress}>{stop.address}</Text>}
          {!!stop.notes && <Text style={s.stopNote}>Логіст: {stop.notes}</Text>}

          <View style={s.stopMeta}>
            {stop.amount > 0 && <Text style={s.metaPlain}>{formatUAH(stop.amount)}</Text>}
            {stop.debtAmount > 0 && (
              <Text style={s.metaBad}>борг {formatUAH(stop.debtAmount)}</Text>
            )}
            {stop.visit?.collectedAmount != null && stop.visit.collectedAmount > 0 && (
              <Text style={s.metaGood}>забрано {formatUAH(stop.visit.collectedAmount)}</Text>
            )}
            {queued && (
              <Text style={s.metaWarn}>
                збережено на пристрої{stop.visit?.status === "MISSED" ? " · не застав" : ""}
              </Text>
            )}
            {!queued && missed && <Text style={s.metaBad}>не застав</Text>}
            {/*
              Пін, знайдений геокодером лише до міста, гірший за відсутність
              піна: виглядає точним, а веде «десь у той бік». Водій має знати
              це до того, як довіриться навігатору. Те саме підписано й на
              сайті — /driver/tablet.
            */}
            {stop.geoSource !== "MANUAL" && stop.lat != null && (
              <Text style={s.metaWarn}>точка приблизна</Text>
            )}
          </View>
        </View>

        {!marked && (
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} color={c.text3} />
        )}
      </Pressable>

      {/* Минулий день: показуємо, що було, і дорогу — без кнопок відміток. */}
      {expanded && readOnly && (
        <View style={s.panel}>
          <Body>
            {stop.visit?.status === "DONE"
              ? "Точку відмічено як пройдену."
              : stop.visit?.status === "MISSED"
                ? "Того дня в точку не потрапили."
                : "Відмітки за цю точку немає."}
          </Body>
          {stop.lat != null && stop.lng != null && (
            <Pressable
              style={[s.mapLink, s.mapLinkPrimary]}
              onPress={() =>
                Linking.openURL(pointUrl({ lat: stop.lat as number, lng: stop.lng as number }))
              }
            >
              <Icon name="navigation" size={16} color={c.onDark} />
              <Text style={[s.mapLinkLabel, { color: c.onDark }]}>Відкрити в Google Maps</Text>
            </Pressable>
          )}
        </View>
      )}

      {expanded && !marked && !readOnly && (
        <View style={s.panel}>
          {/*
            Точка без клієнта — недороблений маршрут, а не збій планшета.
            Мовчазна кнопка змушувала б тикати її знову й знову.
          */}
          {!isErrand && !stop.counterpartyId ? (
            <Callout tone="warn" icon="triangle-alert" title="Точку не прив’язано до клієнта">
              Відмітити її звідси не вийде — логіст не вказав контрагента. Зателефонуйте в офіс,
              там це виправляють за хвилину.
            </Callout>
          ) : isErrand ? (
            <>
              {/* Бонусна поїздка: без товару й без інкасації — лише факт. */}
              <ButtonRow>
                <Button
                  tone="good"
                  label="Виконано"
                  style={s.flex}
                  onPress={() => onMark(stop, "DONE", "NOT_APPLICABLE", { comment })}
                />
                <Button
                  tone="bad"
                  label="Не вийшло"
                  style={s.flex}
                  onPress={() => onMark(stop, "MISSED", "NOT_APPLICABLE", { comment })}
                />
              </ButtonRow>
              <Field value={comment} onChangeText={setComment} placeholder="Коментар (необов’язково)" />
            </>
          ) : (
            <>
              <ButtonRow>
                <Button
                  tone="good"
                  label={
                    stop.debtAmount > 0 ? `Приїхав, забрав ${formatUAH(stop.debtAmount)}` : "Приїхав"
                  }
                  style={s.flex}
                  onPress={() =>
                    onMark(stop, "DONE", stop.debtAmount > 0 ? "FULL" : "NONE", { comment })
                  }
                />
                <Button
                  tone="bad"
                  label="Не потрапив"
                  style={s.flex}
                  onPress={() => onMark(stop, "MISSED", "NOT_APPLICABLE", { comment })}
                />
              </ButtonRow>

              {/* Часткова сума окремим рядком: вона потрібна рідше, ніж
                  «забрав усе», але саме через неї день не сходиться. */}
              <View style={s.moneyRow}>
                <Button
                  tone="outline"
                  small
                  label="Не забрав нічого"
                  style={s.flex}
                  onPress={() => onMark(stop, "DONE", "NONE", { comment })}
                />
                <Field
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder="Сума"
                  style={s.amount}
                />
                <Pressable
                  style={[s.ok, !amount && s.okOff]}
                  disabled={!amount}
                  onPress={() =>
                    onMark(stop, "DONE", "PARTIAL", {
                      collectedAmount: Number(amount.replace(",", ".")),
                      comment,
                    })
                  }
                >
                  <Text style={[s.okLabel, !amount && s.okLabelOff]}>ОК</Text>
                </Pressable>
              </View>

              <Field
                value={comment}
                onChangeText={setComment}
                placeholder="Коментар: магазин закритий, немає грошей…"
              />
            </>
          )}

          {stop.lat != null && stop.lng != null && (
            <Button
              tone="info"
              small
              icon="navigation"
              label="Відкрити в Google Maps"
              onPress={() =>
                Linking.openURL(pointUrl({ lat: stop.lat as number, lng: stop.lng as number }))
              }
            />
          )}
        </View>
      )}
    </View>
  );
}

/* ---------- Каса ---------- */

function CashSection({
  cash,
  day,
  onDone,
}: {
  cash: NonNullable<DayResponse["cash"]>;
  day?: string;
  onDone: () => Promise<void>;
}) {
  // Сума наперед заповнена тим, що водій везе: зазвичай він просто підтверджує.
  const [amount, setAmount] = useState(cash.onHands > 0 ? String(cash.onHands) : "");
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setErr("Вкажіть суму, яку здаєте");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await staffApi.cashHandover({ amount: value, day, comment: comment || undefined });
      setOpen(false);
      setComment("");
      await onDone();
    } catch (e) {
      /**
       * Інкасацію в чергу НЕ кладемо: це гроші, і «здав» без підтвердження
       * офісу — небезпечна ілюзія. Краще чесно сказати, що не пройшло.
       */
      setErr(e instanceof Error ? e.message : "Не вдалося. Спробуйте, коли буде зв’язок");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.block}>
      <Eyebrow>Каса за сьогодні</Eyebrow>

      <View style={s.cashLine}>
        <Text style={s.cashCollected}>Зібрано {formatUAH(cash.collected)}</Text>
        {cash.handed > 0 && <Text style={s.cashHanded}>здано {formatUAH(cash.handed)}</Text>}
      </View>

      {/* «На руках» — головне число дня: саме за нього водій відповідає
          власною кишенею, тому воно й найбільше на екрані. */}
      <View style={s.cashHero}>
        <Text style={s.cashHeroLabel}>На руках:</Text>
        <Text style={s.cashHeroValue}>{formatUAH(cash.onHands)}</Text>
      </View>

      {cash.handovers.map((h) => (
        <View key={h.id} style={s.handover}>
          <View>
            <View style={s.handoverTop}>
              <Text style={s.handoverAmount}>{formatUAH(h.amount)}</Text>
              {!!h.confirmedAt && <Text style={s.handoverTime}>о {formatTime(h.confirmedAt)}</Text>}
            </View>
            <Text style={h.confirmedAt ? s.handoverOk : s.handoverWait}>
              {h.confirmedAt
                ? `Прийнято ${formatUAH(h.confirmedAmount ?? h.amount)}`
                : "Чекає підтвердження офісу"}
            </Text>
          </View>
        </View>
      ))}

      {!!err && <Note tone="bad">{err}</Note>}

      {cash.onHands > 0 &&
        (open ? (
          <View style={s.handoverForm}>
            <Text style={s.formLabel}>Скільки здаєте, ₴</Text>
            <View style={s.amountBox}>
              <Field
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                style={s.amountBig}
              />
            </View>
            <Note>
              Підставлено суму на руках — зазвичай її досить підтвердити. Офіс перевірить і прийме.
            </Note>
            <Field value={comment} onChangeText={setComment} placeholder="Коментар: решта, розмін…" />
            <ButtonRow>
              <Button tone="outline" small label="Скасувати" onPress={() => setOpen(false)} />
              <Button
                tone="good"
                icon="check"
                label={busy ? "Здаю…" : "Підтверджую здачу"}
                disabled={busy}
                style={s.flex}
                onPress={submit}
              />
            </ButtonRow>
            <Note>
              Здача не стає в чергу офлайн: «здав» без підтвердження офісу — небезпечна ілюзія.
            </Note>
          </View>
        ) : (
          <Button
            tone="dark"
            icon="banknote"
            label={`Здаю касу ${formatUAH(cash.onHands)}`}
            onPress={() => setOpen(true)}
          />
        ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  flex: { flex: 1 },

  header: { backgroundColor: c.bk },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: sp.gap,
    paddingTop: 6,
    paddingHorizontal: sp.pad,
    paddingBottom: sp.gap,
  },
  headerLeft: { flex: 1, gap: 3 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: sp.xs },
  headerTitle: { color: c.onDark, fontSize: 16, fontWeight: "700" },
  headerProgress: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  headerMuted: { color: c.onDarkMuted, fontSize: 12 },
  headerMoney: { color: "#4ADE80", fontSize: 12, fontWeight: "600" },
  headerRight: { alignItems: "flex-end", gap: 3 },
  headerKm: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  headerKmValue: { color: c.onDark, fontSize: 18, fontWeight: "700" },
  headerStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  headerStatusLabel: { color: "#D1D5DB", fontSize: 11 },
  headerBuffer: { color: "#FB923C", fontSize: 11, fontWeight: "600" },
  bar: { flexDirection: "row", height: 4, backgroundColor: "#1F2937" },
  barDone: { backgroundColor: c.good },
  barMissed: { backgroundColor: c.bad },

  updateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: sp.sm,
    height: 44,
    backgroundColor: c.brand,
  },
  updateLabel: { color: c.bk, fontSize: 13, fontWeight: "700" },

  section: { paddingHorizontal: sp.pad },
  block: { backgroundColor: c.surface, paddingVertical: 14, paddingHorizontal: sp.pad, gap: 10 },
  /**
   * Полотно списку. Відступ між блоками шапки й підвалу ставиться самими
   * блоками, а не полотном: спільний проміжок роз'єднав би рядки точок.
   */
  list: { paddingTop: sp.sm, backgroundColor: c.bg, flexGrow: 1 },
  headBlock: { marginBottom: sp.sm },
  footBlock: { marginTop: sp.sm },

  queueCard: { padding: sp.gap },
  queueRow: { flexDirection: "row", gap: sp.gap },
  queueText: { flex: 1, gap: 3 },

  nextHead: { flexDirection: "row", alignItems: "center", gap: sp.xs },
  batchRow: { flexDirection: "row", alignItems: "center", gap: sp.xs },
  batchLabel: { fontSize: 12, color: c.text2 },

  autoRow: { flexDirection: "row", alignItems: "center", gap: sp.sm, minHeight: 40 },
  autoBox: {
    width: 20,
    height: 20,
    borderRadius: r.xs,
    borderWidth: 1.5,
    borderColor: c.inputLine,
    alignItems: "center",
    justifyContent: "center",
  },
  autoBoxOn: { borderWidth: 0, backgroundColor: c.bk },
  autoLabel: { fontSize: 13, color: c.text2 },
  autoLabelOn: { color: c.text },
  nextRow: { flexDirection: "row", alignItems: "flex-start", gap: sp.xs },
  nextNum: { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  nextNumFirst: { backgroundColor: c.text },
  nextNumLabel: { fontSize: 12, fontWeight: "800", color: c.text2 },
  nextNumLabelFirst: { color: c.brand },
  nextRowBody: { flex: 1 },
  nextNameSmall: { fontSize: 14, fontWeight: "600", color: c.text },
  nextLeft: { fontSize: 12, color: c.text3 },
  navPick: { marginLeft: "auto", flexDirection: "row", gap: 2, padding: 2, borderRadius: 999, backgroundColor: c.bg },
  navPickItem: { paddingHorizontal: 12, height: 32, justifyContent: "center", borderRadius: 999 },
  navPickItemOn: { backgroundColor: c.text },
  navPickLabel: { fontSize: 12, fontWeight: "700", color: c.text2 },
  navPickLabelOn: { color: c.onDark },
  nextName: { fontSize: 17, fontWeight: "700", color: c.text },
  nextAddress: { fontSize: 13, color: c.text2, lineHeight: 18 },
  wholeToggle: { paddingVertical: 6 },
  wholeToggleLabel: { fontSize: 12, color: c.text3, textDecorationLine: "underline" },

  mapLinks: { flexDirection: "row", gap: sp.sm },
  mapLink: {
    flex: 1,
    height: 48,
    borderRadius: r.btn,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: sp.xs,
  },
  mapLinkPrimary: { backgroundColor: c.info },
  mapLinkSecondary: { backgroundColor: c.infoBg },
  mapLinkLabel: { fontSize: 14, fontWeight: "700" },

  stop: { borderBottomWidth: 1, borderBottomColor: "#F1F1EF", paddingVertical: sp.gap, paddingHorizontal: sp.pad, gap: 10 },
  stopHead: { flexDirection: "row", gap: sp.gap, alignItems: "flex-start" },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  badgeNum: { fontSize: 14, fontWeight: "700", color: "#374151" },
  stopBody: { flex: 1, gap: 3 },
  stopNameRow: { flexDirection: "row", alignItems: "center", gap: sp.xs, flexWrap: "wrap" },
  stopName: { fontSize: 16, fontWeight: "600", color: c.text, flexShrink: 1 },
  stopAddress: { fontSize: 12, color: c.text3 },
  stopNote: { fontSize: 12, color: "#92400E" },
  stopMeta: { flexDirection: "row", gap: 10, flexWrap: "wrap", alignItems: "center" },
  metaPlain: { fontSize: 12, color: "#374151" },
  metaBad: { fontSize: 12, fontWeight: "600", color: c.badFg },
  metaGood: { fontSize: 12, fontWeight: "600", color: c.goodFg },
  metaWarn: { fontSize: 12, fontWeight: "600", color: c.warnFg },
  kind: { backgroundColor: "#FEF3C7", borderRadius: 4, paddingVertical: 1, paddingHorizontal: 6 },
  kindLabel: { fontSize: 11, fontWeight: "700", color: "#92400E" },

  panel: { gap: sp.sm },
  moneyRow: { flexDirection: "row", gap: sp.sm, alignItems: "center" },
  amount: { width: 96, textAlign: "center", fontWeight: "600" },
  ok: {
    height: 46,
    paddingHorizontal: sp.pad,
    borderRadius: r.sm,
    backgroundColor: c.good,
    alignItems: "center",
    justifyContent: "center",
  },
  okOff: { backgroundColor: "#E5E7EB" },
  okLabel: { fontSize: 14, fontWeight: "700", color: c.onDark },
  okLabelOff: { color: c.text3 },

  cashLine: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  cashCollected: { fontSize: 13, color: "#374151" },
  cashHanded: { fontSize: 13, color: c.text3 },
  cashHero: { flexDirection: "row", alignItems: "flex-end", gap: sp.xs },
  cashHeroLabel: { fontSize: 16, color: c.text2 },
  cashHeroValue: { fontSize: 28, fontWeight: "700", color: c.text },
  handover: {
    borderTopWidth: 1,
    borderTopColor: "#F1F1EF",
    paddingTop: sp.sm,
    gap: 2,
  },
  handoverTop: { flexDirection: "row", alignItems: "flex-end", gap: sp.xs },
  handoverAmount: { fontSize: 14, fontWeight: "600", color: c.text },
  handoverTime: { fontSize: 12, color: c.text3 },
  handoverOk: { fontSize: 12, fontWeight: "600", color: c.goodFg },
  handoverWait: { fontSize: 12, fontWeight: "600", color: c.warnFg },
  handoverForm: { borderTopWidth: 1, borderTopColor: "#F1F1EF", paddingTop: 10, gap: sp.sm },
  formLabel: { fontSize: 13, fontWeight: "600", color: "#374151" },
  amountBox: { borderRadius: r.sm, borderWidth: 1, borderColor: c.bk, overflow: "hidden" },
  amountBig: {
    height: 56,
    borderWidth: 0,
    borderRadius: 0,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
});
