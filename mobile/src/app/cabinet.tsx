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
import { downloadAndInstallApk } from "@/lib/self-update";
import { bufferedCount } from "@/track/db";
import { isShiftOpen } from "@/track/state";
import { logoutAndStop, syncTrackingWithServer } from "@/track/controller";
import { IS_STAFF_BUILD } from "@/lib/flavor";
import { colors, space, radius } from "@/theme";

export default function CabinetScreen() {
  const router = useRouter();
  const { target } = useLocalSearchParams<{ target?: string }>();
  const webRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [bridge, setBridge] = useState<BridgeState>({
    shiftOpen: false,
    pending: 0,
    version: APP_VERSION,
    versionCode: APP_VERSION_CODE,
  });

  useFocusEffect(
    useCallback(() => {
      getToken().then(setToken);
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
      const refresh = async () => {
        const [shiftOpen, pending] = await Promise.all([isShiftOpen(), bufferedCount()]);
        if (!alive) return;
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
        downloadAndInstallApk().catch(() => {});
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
    [router]
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
         * Посилання за межі свого домену відкриваємо в зовнішньому браузері:
         * чужа сторінка не має опинятися у вікні, де вже стоїть кукі кабінету.
         */
        onShouldStartLoadWithRequest={(req) => req.url.startsWith(API_BASE)}
        startInLoadingState
        renderLoading={() => <ActivityIndicator style={{ marginTop: space.xl }} color={colors.ink} />}
        style={{ flex: 1 }}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
