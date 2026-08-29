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
import { View, Text, Pressable, StyleSheet, ActivityIndicator, BackHandler } from "react-native";
import { WebView } from "react-native-webview";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { API_BASE } from "@/api/client";
import { APP_VERSION, APP_VERSION_CODE } from "@/api/staff";
import { getToken } from "@/lib/auth-store";
import { bridgeScript, parseBridgeMessage, type BridgeState } from "@/lib/bridge";
import { nativeRouteFor } from "@/lib/native-routes";
import { downloadAndInstallApk } from "@/lib/self-update";
import { bufferedCount } from "@/track/db";
import { isShiftOpen } from "@/track/state";
import { logoutAndStop, syncTrackingWithServer } from "@/track/controller";
import { IS_STAFF_BUILD } from "@/lib/flavor";
import {
  askEnableLocationServices,
  currentPermissions,
  openAppSettings,
  requestTrackingPermissions,
  type PermissionState,
} from "@/track/permissions";
import { within, PROBE_MS } from "@/lib/within";
import { UpdateBar } from "@/ui/UpdateBar";
import { colors, space, radius } from "@/theme";

export default function CabinetScreen() {
  const router = useRouter();
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
  const [updating, setUpdating] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [bridge, setBridge] = useState<BridgeState>({
    shiftOpen: false,
    pending: 0,
    version: APP_VERSION,
    versionCode: APP_VERSION_CODE,
  });

  useFocusEffect(
    useCallback(() => {
      getToken().then(setToken);
      if (IS_STAFF_BUILD) {
        within(currentPermissions(), PROBE_MS, null).then(setPerms);
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
      let last: { shiftOpen: boolean; pending: number } | null = null;

      const refresh = async () => {
        const [shiftOpen, pending] = await Promise.all([isShiftOpen(), bufferedCount()]);
        if (!alive) return;
        const changed = !last || last.shiftOpen !== shiftOpen || last.pending !== pending;
        last = { shiftOpen, pending };
        if (!forced && !changed) return;
        forced = false;

        const next: BridgeState = {
          shiftOpen,
          pending,
          version: APP_VERSION,
          versionCode: APP_VERSION_CODE,
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
      if (msg.type === "openShift") {
        router.push("/shift");
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

  if (!token) return <ActivityIndicator style={{ marginTop: space.xl }} color={colors.ink} />;

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

  const redirect = typeof target === "string" && target.startsWith("/") ? target : "/sales";
  const script = bridgeScript(bridge);

  return (
    <>
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
      {IS_STAFF_BUILD && perms && !perms.foreground && (
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
      {IS_STAFF_BUILD && perms?.foreground && perms.servicesEnabled === false && (
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
      {IS_STAFF_BUILD && perms?.foreground && perms.preciseLocation === false && (
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
      {IS_STAFF_BUILD && perms?.foreground && !perms.background && (
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
          uri: `${API_BASE}/api/device/session?redirect=${encodeURIComponent(redirect)}`,
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
         * Мітка збірки в User-Agent, не заміна його цілком: сайт за нею обирає,
         * яку адресу оновлень питати (стара Kotlin-збірка називає себе інакше),
         * а решта UA лишається браузерною — інакше захист хостингу побачив би
         * клієнта без JS і віддав 429.
         */
        applicationNameForUserAgent={`BudvikStaff/${APP_VERSION}`}
        onNavigationStateChange={(nav) => {
          canGoBack.current = nav.canGoBack;
        }}
        onError={() => setFailed(true)}
        onHttpError={({ nativeEvent }) => {
          // 401 означає, що токен відкликали — далі показувати кабінет нема сенсу.
          if (nativeEvent.statusCode === 401) setFailed(true);
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

          const native = nativeRouteFor(req.url);
          if (native) {
            router.push(native);
            return false;
          }
          return req.url.startsWith(API_BASE);
        }}
        startInLoadingState
        renderLoading={() => <ActivityIndicator style={{ marginTop: space.xl }} color={colors.ink} />}
        style={{ flex: 1 }}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
