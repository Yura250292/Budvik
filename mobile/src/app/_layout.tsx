/**
 * Корінь застосунку: провайдери, замок і навігація верхнього рівня.
 *
 * Вкладки лежать у групі (tabs), а картка товару, сканер і оформлення — окремими
 * екранами поверх них: картка має відкриватися з будь-якої вкладки й повертати
 * туди ж, а сканер — це модальне вікно з камерою, якому таб-бар лише заважає.
 */

/**
 * Оголошення фонових завдань — НАЙПЕРШИМ імпортом.
 *
 * Android піднімає процес заради самого завдання, без жодного інтерфейсу. Якщо
 * на той момент defineTask ще не викликано, система вважає завдання неіснуючим
 * і більше його не будить — тобто трек мовчки помирає до наступного ручного
 * запуску застосунку. Тому цей рядок стоїть вище за все інше й не має
 * переїжджати нижче.
 */
import "@/track/task";

import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { isBiometricEnabled, unlock, clearToken } from "@/lib/auth-store";
import { useNotificationTaps } from "@/track/notification-taps";
import { useTrackHealth } from "@/track/use-track-health";
import { colors, space, radius } from "@/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * Хвилина свіжості: ціни й залишки їдуть з 1С кожні кілька хвилин, тож
       * агресивніше перепитувати нема сенсу, а рідше — можна показати ціну,
       * якої вже немає.
       */
      staleTime: 60_000,
      /**
       * Доба зберігання в памʼяті — стеля для того, що взагалі має шанс
       * потрапити в офлайн-сховище: старіше за це кешувати немає сенсу, ціни
       * встигають змінитися кілька разів.
       */
      gcTime: 24 * 60 * 60_000,
      /**
       * Помилки клієнта не повторюємо.
       *
       * 401 і 404 від повтору не минуть, а два зайві заходи з паузами — це
       * кілька секунд спінера там, де відповідь уже відома. Найпомітніше на
       * обраному в гостя: він бачив крутилку замість пропозиції увійти.
       * Мережеві збої (без статусу) повторюємо як раніше.
       */
      retry: (attempt, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (typeof status === "number" && status >= 400 && status < 500) return false;
        return attempt < 2;
      },
    },
  },
});

/**
 * Офлайн: усе, що людина вже бачила, лишається доступним без мережі.
 *
 * Замість ручного кешу на кожному екрані — постійне сховище для самих
 * запитів: на холодному старті воно підіймається з диска, і каталог, картки
 * та обране малюються одразу, ще до того, як зʼявиться звʼязок.
 *
 * Дзеркала всього каталогу тут немає й не буде: 22 тисячі позицій — це
 * мегабайти, які протухають кожні кілька хвилин після обміну з 1С.
 * Зберігається рівно те, що відкривали.
 */
const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "budvik_query_cache",
});

/**
 * Мітка сумісності збереженого кешу.
 *
 * Кеш лежить на диску й підіймається з нього на кожному запуску — Reload його
 * не чистить, і перезахід за посиланням теж. Тому коли міняється сама форма
 * відповіді сервера, стару копію треба викинути: інакше застосунок показує
 * дані, яких сервер уже не віддає, і виглядає це як зламана збірка.
 *
 * Саме так і сталося з брендами: сервер почав слати банери вітрини й рахувати
 * лише наявний товар, а на екрані тижнями лишалося б «23 261 позиція» зі
 * старої відповіді.
 *
 * Рядок бити руками щоразу, коли міняється форма даних.
 */
const CACHE_SCHEMA = "2026-08-27-brands";

/**
 * У розробці кеш не відновлюємо взагалі.
 *
 * Значення живе стільки ж, скільки контекст JS, тобто змінюється на кожному
 * Reload — і збережена копія щоразу визнається чужою. Інакше правка на
 * сервері не видно на телефоні, доки не мине година свіжості, а розробник
 * шукає її в коді.
 */
const DEV_BUSTER = `dev-${Date.now()}`;

/**
 * Що саме лягає на диск.
 *
 * Профіль і замовлення свідомо НЕ зберігаються: там email, телефон і адреси,
 * а AsyncStorage — це звичайний файл без шифрування. Офлайн-доступ до історії
 * замовлень не вартий того, щоб персональні дані лежали на пристрої відкрито.
 */
const PERSISTED = ["catalog", "product", "brands", "wishlist", "config"];

/**
 * Замок на холодному старті.
 *
 * Показується, лише якщо людина сама увімкнула вхід за біометрією. Каталог за
 * ним не ховаємо назавжди: відмова від відбитка веде не в глухий кут, а до
 * виходу з акаунта — застосунок лишається робочим, просто без кабінету.
 */
function LockGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");

  async function attempt() {
    setState("checking");
    if (!(await isBiometricEnabled())) {
      setState("open");
      return;
    }
    setState((await unlock()) ? "open" : "locked");
  }

  useEffect(() => {
    /*
     * Обгортка навколо attempt(), а не прямий виклик: правило хуків забороняє
     * смикати setState синхронно з ефекту, і React Compiler на цьому
     * зупиняється. Логіка та сама, просто відкладена на мікрозадачу.
     */
    void (async () => {
      await attempt();
    })();
     
  }, []);

  if (state === "checking") {
    return (
      <View style={styles.lock}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (state === "locked") {
    return (
      <View style={styles.lock}>
        <Ionicons name="lock-closed-outline" size={44} color={colors.brand} />
        <Text style={styles.lockTitle}>Будвік27</Text>
        <Text style={styles.lockText}>Підтвердьте, що це ви</Text>

        <Pressable style={styles.lockButton} onPress={attempt}>
          <Text style={styles.lockButtonText}>Спробувати ще раз</Text>
        </Pressable>

        <Pressable
          style={styles.lockSecondary}
          onPress={async () => {
            // Вихід, а не обхід: інакше «Продовжити без входу» перетворювало б
            // замок на кнопку, яку досить натиснути двічі.
            await clearToken();
            setState("open");
          }}
        >
          <Text style={styles.lockSecondaryText}>Увійти паролем</Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  // Тап по нагадуванню «зміна ще відкрита» веде на екран зміни, а не просто
  // відкриває застосунок там, де його закрили.
  useNotificationTaps();
  /**
   * Перевірка живості запису. Потрібна саме тут, а не у сторожі: той працює
   * через WorkManager і без мережі не прокидається — тобто мовчить у селі,
   * де трек і губиться.
   */
  useTrackHealth();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 24 * 60 * 60_000,
          buster: __DEV__ ? DEV_BUSTER : CACHE_SCHEMA,
          dehydrateOptions: {
            shouldDehydrateQuery: (query) =>
              query.state.status === "success" &&
              PERSISTED.includes(String(query.queryKey[0])),
          },
        }}
      >
        <StatusBar style="light" />
        <LockGate>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.ink },
              headerTintColor: colors.brand,
              headerTitleStyle: { color: "#FFFFFF", fontWeight: "700" },
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="cabinet" options={{ title: "Кабінет" }} />
            <Stack.Screen name="scan" options={{ title: "Сканер", presentation: "modal" }} />
            <Stack.Screen name="day" options={{ title: "Мій день" }} />
            <Stack.Screen name="shift/index" options={{ title: "Зміна" }} />
            <Stack.Screen name="shift/odometer" options={{ title: "Одометр" }} />
            <Stack.Screen name="shift/history" options={{ title: "Історія змін" }} />
            <Stack.Screen name="shift/late-close" options={{ title: "Забув закрити зміну" }} />
          </Stack>
        </LockGate>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  lock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    backgroundColor: colors.ink,
    padding: space.xl,
  },
  lockTitle: { fontSize: 22, fontWeight: "800", color: colors.brand },
  lockText: { color: "#D1D5DB", fontSize: 14 },
  lockButton: {
    marginTop: space.lg,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  lockButtonText: { fontWeight: "700", color: colors.ink },
  lockSecondary: { padding: space.md },
  lockSecondaryText: { color: "#9CA3AF", fontSize: 13 },
});
