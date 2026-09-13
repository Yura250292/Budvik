/**
 * Робочий кабінет — сайт усередині застосунку.
 *
 * Нативно його не переписуємо свідомо. Кабінет торгового й водія — це велика
 * ERP-поверхня, яка змінюється щотижня; нативна копія означала б дві версії
 * кожного екрана й новий APK на кожну правку. Той самий висновок уже зроблено
 * в трекері, і він себе виправдав: оновлення сайту доїжджають до планшетів без
 * релізу.
 *
 * Для покупецької частини WebView, навпаки, заборонений — Apple відхиляє
 * обгортки сайту. Тому в застосунку співіснують обидва підходи, кожен там, де
 * доречний.
 *
 * Сесію ставить сервер: застосунок відкриває /api/device/session з Bearer у
 * заголовку, той мінтить кукі NextAuth і робить 302 у кабінет. Токен при цьому
 * не потрапляє ні в адресу, ні в сам документ.
 */

import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, BackHandler, Linking, PermissionsAndroid, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback } from "react";
import { API_BASE } from "@/api/client";
import { APP_VERSION_CODE, NATIVE_VERSION } from "@/api/staff";
import { installedVersionCode } from "@/lib/self-update";
import { getToken } from "@/lib/auth-store";
import { bridgeScript, parseBridgeMessage, type BridgeState } from "@/lib/bridge";
import { nativeRouteFor } from "@/lib/native-routes";
import { downloadAndInstallApk } from "@/lib/self-update";
import { bufferedCount, logEvent } from "@/track/db";
import { getRole, isShiftOpen } from "@/track/state";
import { logoutAndStop, syncTrackingWithServer } from "@/track/controller";
import { IS_STAFF_BUILD } from "@/lib/flavor";
import { bootBegin, bootDone, bootReport } from "@/lib/boot";
import { registerForPush } from "@/lib/push";
import {
  askEnableLocationServices,
  currentPermissions,
  openAppSettings,
  requestTrackingPermissions,
  type PermissionState,
} from "@/track/permissions";
import { within, PROBE_MS } from "@/lib/within";

/**
 * Що система думає про мікрофон ПРЯМО ЗАРАЗ.
 *
 * Питаємо саме систему, а не пам'ять застосунку: дозвіл міняють руками в
 * налаштуваннях, і жодної події про це нам ніхто не шле. Відповідь їде в
 * сторінку разом із рештою стану мосту — щоб у мить помилки вона могла
 * сказати правду, а не здогад.
 */
async function micPermission(): Promise<"granted" | "denied" | "unknown"> {
  if (Platform.OS !== "android") return "unknown";
  try {
    const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return ok ? "granted" : "denied";
  } catch {
    // Дозволу немає в маніфесті або система відмовила — не стверджуємо нічого.
    return "unknown";
  }
}
import { UpdateBar } from "@/ui/UpdateBar";
import { colors, space, radius } from "@/theme";

/**
 * Номер ВСТАНОВЛЕНОЇ збірки — те, з чим сайт порівнює сховище.
 *
 * `APP_VERSION_CODE` бралося з `Constants.expoConfig`, тобто з JS-бандла. А
 * бандл їде повітрям: зібраний із дерева, де версія вже 1.6.3, він називав
 * себе 10603 на планшеті, де стоїть APK 10602. Сайт порівнював 10603 із 10603,
 * вирішував «уже найновіша» і ХОВАВ пункт «Оновити застосунок» у меню
 * аватарки — тобто єдиний шлях, яким збірку й ставлять.
 *
 * 12.09.2026 через це APK 1.6.3 не пропонувався жодному планшету, хоча лежав
 * у сховищі з ранку. Третє місце з тією самою пасткою: пульс (2bb42c2),
 * User-Agent кабінету (2302f84) і ось це.
 *
 * `nativeBuildVersion` читає маніфест справді встановленого APK. Нуль
 * повертається поза Android — там лишається версія бандла, бо іншої немає.
 */
function installedCode(): number {
  return installedVersionCode() || APP_VERSION_CODE;
}

/** Скільки чекати сигналу сторінки після кінця HTML, перш ніж зняти заставку самим. */
const READY_FALLBACK_MS = 3000;

export default function CabinetScreen() {
  const router = useRouter();
  /**
   * Відступ під рядок стану — саме тут, а не на сайті.
   *
   * Android 15 малює застосунок від краю до краю, а `env(safe-area-inset-top)`
   * усередині WebView дорівнює нулю: сторінка не знає, що над нею годинник і
   * значки мережі. Через це шапка кабінету заповзала під них — на складі це
   * помітили першими, бо в його шапці два рядки, і надзаголовок ховався
   * повністю.
   *
   * Лікувати це на сайті не можна: у браузері відступ узявся б нізвідки. Тому
   * місце під рядок стану лишає застосунок, а сторінка починається під ним.
   */
  const insets = useSafeAreaInsets();
  const { target } = useLocalSearchParams<{ target?: string }>();
  const webRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * Дозволи на місце. Читаються тут, бо кабінет — єдиний екран, який
   * відкривають гарантовано: до «Зміни» більшість не доходить, а без дозволу
   * застосунок мовчки не пише нічого.
   */
  const [perms, setPerms] = useState<PermissionState | null>(null);
  /**
   * Хід завантаження нової збірки, 0..1, або null — коли не качаємо.
   *
   * Без цього кнопка «Оновити застосунок» виглядала зламаною: 115 МБ їдуть
   * кілька хвилин, і весь цей час на екрані не змінювалося НІЧОГО. Людина
   * тиснула ще раз, потім ще — і йшла казати, що оновлення не працює.
   */
  /**
   * Роль людини — щоб не лякати того, хто маршрут не пише.
   *
   * Смуги про дозвіл локації писалися для торгового й водія: у них без
   * дозволу зникає день. Складовщик (роль WAREHOUSE, з 07.09) заходить у той
   * самий кабінет заради накладних і треку не веде взагалі — червоне
   * «Маршрут не пишеться» в нього означало б поламку, якої немає.
   *
   * `null` (роль ще не прочитана або стара збірка без позначки) поводиться
   * як раніше: краще показати зайву смугу, ніж сховати потрібну.
   */
  const [role, setRole] = useState<string | null>(null);
  /** Маршрут ведуть торговий і водій. Решта заходить у кабінет по інших справах. */
  const tracksRoute = role === null || role === "SALES" || role === "DRIVER";
  const [updating, setUpdating] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  /**
   * Вихід із акаунта показуємо, а не мовчимо.
   *
   * Він дописує буфер треку й гасить токен на сервері — тобто ходить у
   * мережу. Поки цього екрана не було, кабінет просто застигав: сторінка на
   * місці, кнопка натиснута, і нічого не відбувається півхвилини. Людина
   * вирішувала, що застосунок завис, і вимикала планшет — саме посеред
   * відправки маршруту.
   */
  const [leaving, setLeaving] = useState(false);
  const [bridge, setBridge] = useState<BridgeState>({
    shiftOpen: false,
    pending: 0,
    version: NATIVE_VERSION,
    versionCode: installedCode(),
    micPermission: "unknown",
  });

  /**
   * Заставка запуску — з монтажу кабінету, а не з фокуса.
   *
   * Після входу кабінет з'являється, коли заставка холодного старту вже
   * пішла, і WebView знову вантажиться з нуля: без цього виклику людина
   * дивилася б на порожній чорний екран. На холодному старті виклик нічого
   * не міняє — заставка вже стоїть.
   *
   * Саме useEffect, а не useFocusEffect нижче: той спрацьовує й при
   * поверненні зі «Зміни» чи «Мого дня», і логотип перекривав би вже
   * відкритий кабінет щоразу.
   */
  useEffect(() => {
    if (IS_STAFF_BUILD) bootBegin();
  }, []);

  /**
   * Запасний вихід із заставки, коли сторінка сама не скаже «готово».
   *
   * Сигнал `ready` подає гейт кабінету на сайті. Старий сайт (до 13.09.2026)
   * його не знає, а сторінка помилки без гейта не подасть ніколи. Тоді
   * заставку знімаємо через кілька секунд після кінця HTML: гейт устигає
   * дістати сесію, а людина не встигає вирішити, що застосунок завис.
   *
   * Таймер гаситься при виході з екрана: інакше після виходу й швидкого
   * повторного входу старий таймер зняв би заставку нового кабінету.
   */
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const timers = readyTimer;
    return () => {
      if (timers.current) clearTimeout(timers.current);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      /*
        Без токена кабінет не відкриється взагалі, і ховати таку поломку за
        логотипом до стелі в 20 секунд гірше, ніж показати її одразу.
      */
      getToken().then((t) => {
        setToken(t);
        if (t) bootReport("token", 0.3);
        else bootDone();
      });
      if (IS_STAFF_BUILD) {
        within(currentPermissions(), PROBE_MS, null).then(setPerms);
        within(getRole(), PROBE_MS, null).then(setRole);
      }
    }, [])
  );

  /**
   * Холодний старт: звіряємо запис маршруту із сервером.
   *
   * Планшет міг бути вимкнений, коли офіс закрив зміну, а водій — просто
   * перезавантажити пристрій (після ребуту Android не відновлює доставку
   * координат сам). Робимо це тут, бо кабінет — гарантована точка входу
   * працівника: на нього веде і вхід, і холодний старт із track-токеном.
   */
  useEffect(() => {
    if (!IS_STAFF_BUILD) return;
    syncTrackingWithServer(null).catch(() => {});
    /**
     * Реєстрація пушів не тільки при вході.
     *
     * Торгові вже залоговані місяцями й екрана входу більше не бачать —
     * якби токен Expo брався лише там, сповіщення про рух у табло не
     * прийшло б жодному з них. Повторний виклик дешевий: upsert по тому
     * самому токену, а всередині ще й пам'ять про вже надісланий.
     */
    registerForPush().catch(() => {});
  }, []);

  /**
   * Стан для мосту читаємо самі й переінжектуємо в сторінку.
   *
   * Сайт викликає shiftStateJson() синхронно просто в рендері — спитати нас
   * через postMessage він не може. Тому свіжий стан має вже лежати в сторінці
   * на момент виклику: оновлюємо його при поверненні на екран і раз на пів
   * хвилини, поки кабінет відкритий.
   */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      /**
       * Повернення на екран інжектує завжди, тік таймера — лише коли є що
       * оновити: за пів хвилини простою стан здебільшого той самий, а кожна
       * ін'єкція будить JS сторінки посеред роботи людини.
       */
      let forced = true;
      let last: { shiftOpen: boolean; pending: number; mic: string } | null = null;

      const refresh = async () => {
        const [shiftOpen, pending, mic] = await Promise.all([
          isShiftOpen(),
          bufferedCount(),
          micPermission(),
        ]);
        if (!alive) return;
        const changed =
          !last || last.shiftOpen !== shiftOpen || last.pending !== pending || last.mic !== mic;
        last = { shiftOpen, pending, mic };
        if (!forced && !changed) return;
        forced = false;

        const next: BridgeState = {
          shiftOpen,
          pending,
          version: NATIVE_VERSION,
          versionCode: installedCode(),
          micPermission: mic,
        };
        setBridge(next);
        webRef.current?.injectJavaScript(bridgeScript(next));
      };
      refresh();
      const timer = setInterval(refresh, 30_000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [])
  );

  /**
   * Завантаження й установка нової збірки — з поступом і помилкою на екрані.
   *
   * Помилку показуємо, а не ковтаємо: раніше тут стояв `.catch(() => {})`, і
   * будь-який збій — немає місця на диску, обірвана мережа, відмова
   * встановлювача — виглядав однаково: нічого не сталося.
   */
  const startDownload = useCallback(() => {
    if (updating !== null) return; // друге натискання не починає другу качку
    setUpdateError(null);
    setUpdating(0);
    downloadAndInstallApk((fraction) => setUpdating(fraction))
      .then(() => setUpdating(null))
      .catch((e) => {
        setUpdating(null);
        setUpdateError(e instanceof Error ? e.message : "Не вдалося завантажити збірку");
      });
  }, [updating]);

  /** Команди із сайту: кнопка зміни, вихід, оновлення застосунку. */
  const handleBridgeMessage = useCallback(
    (raw: string) => {
      const msg = parseBridgeMessage(raw);
      if (!msg) return;
      /*
        Сторінка показала вміст — знімаємо заставку запуску.

        Першою гілкою і з `return` обов'язково: у кінці цього ланцюжка все,
        що не впізнано, трактується як вихід із акаунта. Пропущений return
        тут означав би, що кабінет вилогінює людину на кожному запуску.
      */
      if (msg.type === "ready") {
        if (readyTimer.current) clearTimeout(readyTimer.current);
        bootDone();
        return;
      }
      if (msg.type === "openShift") {
        router.push("/shift");
        return;
      }
      if (msg.type === "openScanner") {
        router.push("/warehouse/scan");
        return;
      }
      if (msg.type === "requestMic") {
        /*
          Дозвіл на мікрофон — напряму в системи, і до кінця.

          WebView уміє просити його сам, але діалог з'являється не завжди:
          07.09 власник оновився на 1.6.0, натиснув мікрофон і прочитав
          «мікрофон недоступний, перевірте дозвіл» при виданому дозволі.

          Головне тут — третій стан. Коли дозвіл заборонено «назавжди»,
          `request` повертає never_ask_again МОВЧКИ: жодного діалога, і
          зовні це не відрізнити від того, що людина просто не встигла
          натиснути. Тоді єдиний шлях — екран налаштувань застосунку, і ми
          відкриваємо його самі, а не радимо його пошукати.
        */
        void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
          title: "Мікрофон для помічника",
          message: "Щоб ставити питання голосом, застосунку потрібен мікрофон.",
          buttonPositive: "Дозволити",
          buttonNegative: "Не зараз",
        })
          .then((result) => {
            if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return openAppSettings();
          })
          .catch(() => {});
        return;
      }
      if (msg.type === "openAppSettings") {
        void openAppSettings().catch(() => {});
        return;
      }
      if (msg.type === "reportMic") {
        /*
          Скарга сторінки — у журнал пристрою, поруч із подіями треку.

          Окремої колонки в пульсі під це не заводимо: журнал уже доставляється
          разом із ним і читається в пульті. А головне — тут до слів сторінки
          додається те, чого вона знати не може: що про дозвіл каже САМА
          система. Розбіжність між цими двома і є відповіддю.
        */
        void micPermission()
          .then((perm) => logEvent("mic", `${msg.detail ?? "—"} · система=${perm}`))
          .catch(() => {});
        return;
      }
      if (msg.type === "openDay") {
        /*
          Маршрутний лист несемо з собою: у водія їх на добу буває два, і
          «Мій день» без ключа показав би не той. Ключ той самий, що в адресі
          сайту (`?route=dr:…`), тож обидва шляхи ведуть в одне місце.
        */
        router.push(
          (msg.route
            ? `/day?route=${encodeURIComponent(msg.route)}`
            : "/day") as Parameters<typeof router.push>[0]
        );
        return;
      }
      if (msg.type === "downloadUpdate") {
        startDownload();
        return;
      }
      /**
       * Вихід мусить пройти через застосунок, а не через сайт: окрім кукі
       * кабінету є ще токен пристрою, і поки він живий, планшет далі пише трек.
       * Саме тому міст перехоплює logout, а не лишає його сторінці.
       */
      setLeaving(true);
      // Екран виходу має бути видно, навіть якщо вихід натиснули раніше за «готово».
      bootDone();
      logoutAndStop()
        .catch(() => {})
        .finally(() => router.replace("/(tabs)/account"));
    },
    [router, startDownload]
  );

  /**
   * Системна «назад» ходить по історії кабінету, а не закриває екран одразу.
   * Інакше один необережний жест викидає торгового з форми, яку він заповнював.
   */
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (canGoBack.current) {
          webRef.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [])
  );

  /**
   * Робочі екрани є лише в робочій збірці.
   *
   * У сторовій їх немає навмисно: рецензент Apple отримує демо-акаунт і
   * перевіряє все, що за логіном. ERP-панель усередині «застосунку магазину»
   * — це і питання про фонову геолокацію, і привід згадати правило про
   * обгортки сайту.
   */
  if (!IS_STAFF_BUILD) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Робочий кабінет" }} />
        <Text style={styles.title}>Це застосунок для покупців</Text>
        <Text style={styles.text}>
          Ваш акаунт — робочий. Кабінет торгового й водія живе в окремій збірці, яку видають на
          планшет: відкрийте на ньому сторінку встановлення на сайті.
        </Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Назад</Text>
        </Pressable>
      </View>
    );
  }

  if (leaving) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Вихід" }} />
        <ActivityIndicator color={colors.ink} />
        <Text style={styles.title}>Виходжу з акаунта</Text>
        <Text style={styles.text}>
          Дописую маршрут і гашу токен планшета. Це кілька секунд — не вимикайте застосунок.
        </Text>
      </View>
    );
  }

  /*
    Чорна оболонка, а не голий спінер на білому: зазвичай її накриває
    заставка, а якщо та вже пішла — білого кадру перед кабінетом немає.
  */
  if (!token) {
    return (
      <View style={[styles.shell, styles.centerDark]}>
        <Stack.Screen options={{ title: "Кабінет", headerShown: false }} />
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Кабінет" }} />
        <Text style={styles.title}>Кабінет не відкрився</Text>
        <Text style={styles.text}>
          Схоже, немає звʼязку. Трек і зміна від цього не залежать — вони пишуться далі.
        </Text>
        <Pressable style={styles.button} onPress={() => setFailed(false)}>
          <Text style={styles.buttonText}>Спробувати ще раз</Text>
        </Pressable>
      </View>
    );
  }

  /**
   * Куди відкривати кабінет — вирішує сервер за роллю, а не ця сторінка.
   *
   * Тут стояло жорстке "/sales" на випадок, коли адреси не передали, — а не
   * передають її саме на холодному старті ((tabs)/_layout шле сюди без
   * параметра, свідомо: «одне правило на всі входи»). Виходило навпаки:
   * складовщик і водій щоранку відкривали кабінет ТОРГОВОГО, гейт секції їх
   * не пускав, і після довгого завантаження людина читала «Доступ заборонено.
   * На головну» — при живому акаунті й правильній ролі.
   *
   * Порожньо означає «вирішуй сам»: /api/device/session бере
   * defaultTargetFor(role) — /sales, /driver, /warehouse або /admin.
   */
  const redirect = typeof target === "string" && target.startsWith("/") ? target : null;
  const script = bridgeScript(bridge);

  return (
    /* Чорний фон під відступом: шапка кабінету теж чорна, тож рядок стану
       читається як її продовження, а не як смуга іншого кольору. */
    <View style={[styles.shell, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: "Кабінет", headerShown: false }} />

      {/* Кабінет — єдиний екран, який торговий відкриває щодня, тож саме тут
          оновлення й має пропонувати себе. */}
      <UpdateBar />

      {updating !== null && (
        <View style={styles.dlStrip}>
          <Text style={styles.dlText}>
            Завантажую нову збірку… {Math.round(updating * 100)}%
          </Text>
          <View style={styles.dlTrack}>
            <View style={[styles.dlFill, { flex: Math.max(0.01, updating) }]} />
            <View style={{ flex: Math.max(0.01, 1 - updating) }} />
          </View>
          <Text style={styles.dlHint}>
            Це кілька хвилин. Не закривайте застосунок — коли завантажиться, Android сам запитає
            про встановлення.
          </Text>
        </View>
      )}

      {!!updateError && (
        <Pressable style={styles.dlError} onPress={() => setUpdateError(null)}>
          <Text style={styles.dlErrorTitle}>Не вдалося завантажити оновлення</Text>
          <Text style={styles.dlErrorText}>{updateError}</Text>
        </Pressable>
      )}

      {/*
        Найдорожча тиша в застосунку — та, про яку ніхто не знає.
        
        Дозвіл на місце просили лише при відкритті зміни. Хто поставив
        застосунок і просто зайшов у кабінет, лишався без дозволу, і трек не
        писався взагалі — жодної помилки, жодного натяку, а ввечері виявлялося,
        що дня немає. Саме так і сталося з першим планшетом на новій збірці:
        стоїть з ранку, дозвіл DENIED, нуль точок.

        Тому смуга тут, а не на екрані зміни: кабінет відкривають усі й щодня.
      */}
      {IS_STAFF_BUILD && tracksRoute && perms && !perms.foreground && (
        <Pressable
          style={styles.permStrip}
          onPress={() => requestTrackingPermissions().then(setPerms)}
        >
          <Text style={styles.permTitle}>Маршрут не пишеться</Text>
          <Text style={styles.permText}>
            Застосунок не має доступу до місця. Натисніть, щоб дозволити — інакше день не
            зарахується.
          </Text>
        </Pressable>
      )}

      {/*
        Дозвіл є, а місце вимкнене — найпідступніший зі станів.

        Він не схожий на поломку: застосунок працює, крапка на карті рухається,
        трек пишеться. Тільки координати приходять по вежах, і замість вулиці в
        дні лежить район із похибкою в сотні метрів. Так у полі два дні йшов
        маршрут, який розійшовся з одометром на 47 км, і жоден екран про це не
        сказав.

        Одне натискання: система показує своє вікно й вмикає високу точність.
      */}
      {IS_STAFF_BUILD && tracksRoute && perms?.foreground && perms.servicesEnabled === false && (
        <Pressable
          style={styles.permStrip}
          onPress={() => askEnableLocationServices().then(() => currentPermissions().then(setPerms))}
        >
          <Text style={styles.permTitle}>Геолокацію вимкнено</Text>
          <Text style={styles.permText}>
            Дозвіл є, але саме визначення місця вимкнене — маршрут пишеться по вежах, з похибкою в
            сотні метрів. Натисніть, щоб увімкнути.
          </Text>
        </Pressable>
      )}

      {/* Місце дали «Приблизно» — координати з точністю до району. Перемикається
          лише руками: повторний запит Android уже не показує. */}
      {IS_STAFF_BUILD && tracksRoute && perms?.foreground && perms.preciseLocation === false && (
        <Pressable
          style={styles.permStrip}
          onPress={() => openAppSettings().then(() => currentPermissions().then(setPerms))}
        >
          <Text style={styles.permTitle}>Увімкніть «Точне місцезнаходження»</Text>
          <Text style={styles.permText}>
            Зараз стоїть «Приблизно» — це район, а не вулиця. Натисніть і в дозволах застосунку
            оберіть «Точно».
          </Text>
        </Pressable>
      )}

      {/* Дозвіл є, але лише «поки відкрито»: запис обірветься, щойно згасне
          екран, — а це станеться на першому ж перегоні між клієнтами. */}
      {IS_STAFF_BUILD && tracksRoute && perms?.foreground && !perms.background && (
        <Pressable
          style={[styles.permStrip, styles.permStripWarn]}
          onPress={() => requestTrackingPermissions().then(setPerms)}
        >
          <Text style={[styles.permTitle, styles.permTitleWarn]}>Оберіть «Дозволяти завжди»</Text>
          <Text style={[styles.permText, styles.permTextWarn]}>
            Зараз стоїть «Тільки під час використання» — запис зупиниться, коли екран згасне.
          </Text>
        </Pressable>
      )}

      <WebView
        ref={webRef}
        source={{
          uri: redirect
            ? `${API_BASE}/api/device/session?redirect=${encodeURIComponent(redirect)}`
            : `${API_BASE}/api/device/session`,
          headers: { Authorization: `Bearer ${token}` },
        }}
        /**
         * Міст вставляється двічі навмисно: гачок «перед завантаженням» на
         * Android інколи пропускає навігацію всередині кабінету, і сторінка
         * лишалася б без window.BudvikApp — тобто без кнопки зміни й без
         * виходу, що чистить токен. Скрипт ідемпотентний, повтор нешкідливий.
         */
        injectedJavaScriptBeforeContentLoaded={script}
        injectedJavaScript={script}
        /** Без onMessage Android не створює window.ReactNativeWebView взагалі. */
        onMessage={(e) => handleBridgeMessage(e.nativeEvent.data)}
        /**
         * Геолокація у WebView — вимкнена за замовчуванням, і це не дрібниця.
         *
         * На ній тримається половина роботи торгового: «Уточнити точку» ставить
         * пін магазину рівно там, де стоїть планшет, а нотатка й фото воріт
         * зберігаються з координатами — саме за ними наступного разу знаходять
         * заїзд. Без цього прапорця `navigator.geolocation` у кабінеті мовчки
         * відмовляє, і людина бачить «не вдалося визначити місце» знову й знову,
         * стоячи просто перед магазином під відкритим небом.
         *
         * Дозвіл системи в робочій збірці вже є (фоновий трек), тож WebView
         * лише перестає його ховати.
         */
        geolocationEnabled
        /**
         * Мікрофон у WebView — для голосового питання помічнику.
         *
         * `MediaRecorder` у системному WebView є (на відміну від
         * розпізнавання мовлення, якого там немає зовсім), тож запис іде
         * звідси, а розпізнає сервер. Але дозвіл сторінці WebView мусить
         * видати сам: без цього `getUserMedia` мовчки відмовляє, і кнопка
         * мікрофона виглядає зламаною.
         *
         * На Android системний діалог показує сама бібліотека, коли
         * сторінка просить мікрофон: їй досить дозволу RECORD_AUDIO у
         * маніфесті (app.config.ts). На iOS дозвіл видається цим
         * прапорцем плюс рядок-пояснення в Info.plist.
         */
        mediaCapturePermissionGrantType="grant"
        /**
         * Мітка збірки в User-Agent, не заміна його цілком: сайт за нею обирає,
         * яку адресу оновлень питати (стара Kotlin-збірка називає себе інакше),
         * а решта UA лишається браузерною — інакше захист хостингу побачив би
         * клієнта без JS і віддав 429.
         *
         * Версія ОБОЛОНКИ, а не бандла. Сервер пише її в
         * `app:staff:installed:<id>` (api/app/staff/version), і саме за цим
         * рядком дивляться, хто вже поставив новий APK. З версією бандла він
         * брехав: 12.09.2026 всі шість планшетів показували «1.6.3», хоча APK
         * не поставив жоден — оновлення повітрям, зібране з дерева 1.6.3,
         * називало себе його версією. Та сама пастка, що й у пульсі (див.
         * lib/app-version.ts).
         */
        applicationNameForUserAgent={`BudvikStaff/${NATIVE_VERSION}`}
        onNavigationStateChange={(nav) => {
          canGoBack.current = nav.canGoBack;
        }}
        onError={() => {
          setFailed(true);
          // «Кабінет не відкрився» мусить бути видно одразу, а не після стелі заставки.
          bootDone();
        }}
        onHttpError={({ nativeEvent }) => {
          // 401 означає, що токен відкликали — далі показувати кабінет нема сенсу.
          if (nativeEvent.statusCode === 401) {
            setFailed(true);
            bootDone();
          }
        }}
        /**
         * Дві перевірки в одному місці.
         *
         * Перша: сторінки, які вже переписані нативно, не відкриваємо у
         * WebView — перехоплюємо перехід і показуємо нативний екран. Так
         * кабінет переїжджає по одному екрану за реліз, і на сайті нічого не
         * доводиться міняти: посилання лишаються ті самі.
         *
         * Друга: посилання за межі свого домену йдуть у зовнішній браузер —
         * чужа сторінка не має опинятися у вікні, де вже стоїть кукі кабінету.
         */
        onShouldStartLoadWithRequest={(req) => {
          /**
           * Посилання на APK перехоплюємо й качаємо самі.
           *
           * У react-native-webview на Android немає обробника завантажень:
           * перехід на файл просто нічого не робить. Кнопка «Завантажити APK»
           * на /sales/app і /driver/app усередині застосунку була глухою — і
           * це виглядало точно так само, як зламане оновлення.
           */
          if (/\/api\/app\/(staff\/)?download(\?|$)/.test(req.url)) {
            startDownload();
            return false;
          }

          /**
           * Карти й навігація відкриваються системою, а не всередині.
           *
           * WebView повертає false на все, що не наш домен, — і посилання
           * «маршрут у Google Maps» у помічника торгового просто нічого не
           * робило. Google Maps і Waze усередині WebView усе одно не
           * працюють як навігація: їм потрібен свій застосунок.
           */
          if (/^(https:\/\/(www\.)?google\.[a-z.]+\/maps|https:\/\/maps\.app\.goo\.gl|https:\/\/(www\.)?waze\.com|waze:|geo:|tel:)/i.test(req.url)) {
            Linking.openURL(req.url).catch(() => {});
            return false;
          }

          const native = nativeRouteFor(req.url);
          if (native) {
            // Рядок із параметрами — expo-router типізує шляхи літералами,
            // а наш складається під час виконання (несе ключ листа).
            router.push(native as Parameters<typeof router.push>[0]);
            return false;
          }
          return req.url.startsWith(API_BASE);
        }}
        /*
          Хід завантаження — у заставку запуску.

          Власної заглушки WebView більше немає: у бібліотеці вона зашита
          білою (loadingOrErrorView), і перефарбувати її нічим — лише прибрати.
          Чорний фон самого WebView — на випадок, коли заставка вже пішла
          (стеля), а сторінка ще не намалювалася.

          Частка 0,30–0,85 під сторінку: нижче — те, що пройдено до неї
          (замок, розвилка, токен), вище — запас на «майже готово», поки гейт
          сторінки питає сесію. Після першого «готово» доповіді мовчать, тож
          переходи по кабінету заставку не будять.
        */
        onLoadProgress={({ nativeEvent }) => bootReport("page", 0.3 + 0.55 * nativeEvent.progress)}
        onLoadEnd={() => {
          bootReport("page", 0.9);
          if (readyTimer.current) clearTimeout(readyTimer.current);
          readyTimer.current = setTimeout(bootDone, READY_FALLBACK_MS);
        }}
        style={{ flex: 1, backgroundColor: colors.ink }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.ink },
  centerDark: { alignItems: "center", justifyContent: "center" },
  dlStrip: { backgroundColor: "#0A0A0A", paddingVertical: 10, paddingHorizontal: space.lg, gap: 6 },
  dlText: { color: "#FFD600", fontSize: 14, fontWeight: "700" },
  dlTrack: { flexDirection: "row", height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: "#1F2937" },
  dlFill: { backgroundColor: "#FFD600" },
  dlHint: { color: "#9CA3AF", fontSize: 12, lineHeight: 16 },
  dlError: { backgroundColor: "#FEF2F2", borderBottomWidth: 1, borderBottomColor: "#FECACA", paddingVertical: 10, paddingHorizontal: space.lg, gap: 2 },
  dlErrorTitle: { color: "#B91C1C", fontSize: 14, fontWeight: "700" },
  dlErrorText: { color: "#5B6068", fontSize: 12, lineHeight: 16 },
  permStrip: { backgroundColor: "#DC2626", paddingVertical: 10, paddingHorizontal: space.lg, gap: 2 },
  permStripWarn: { backgroundColor: "#FFFBEB", borderBottomWidth: 1, borderBottomColor: "#FDE68A" },
  permTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  permTitleWarn: { color: "#B45309" },
  permText: { color: "#FFFFFFD9", fontSize: 12, lineHeight: 16 },
  permTextWarn: { color: "#5B6068" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  title: { fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" },
  text: { fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: "center" },
  button: {
    marginTop: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  buttonText: { fontWeight: "700", color: colors.ink },
});
