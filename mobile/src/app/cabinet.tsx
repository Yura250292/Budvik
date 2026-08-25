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

import { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, BackHandler } from "react-native";
import { WebView } from "react-native-webview";
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { API_BASE } from "@/api/client";
import { getToken } from "@/lib/auth-store";
import { IS_STAFF_BUILD } from "@/lib/flavor";
import { colors, space, radius } from "@/theme";

export default function CabinetScreen() {
  const router = useRouter();
  const { target } = useLocalSearchParams<{ target?: string }>();
  const webRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getToken().then(setToken);
    }, [])
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

  return (
    <>
      <Stack.Screen options={{ title: "Кабінет", headerShown: false }} />
      <WebView
        ref={webRef}
        source={{
          uri: `${API_BASE}/api/device/session?redirect=${encodeURIComponent(redirect)}`,
          headers: { Authorization: `Bearer ${token}` },
        }}
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
