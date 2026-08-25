/**
 * Оформлення замовлення.
 *
 * Працює і без входу: POST /api/v1/orders приймає гостя й повертає guestToken,
 * за яким потім видно статус. Змушувати заводити акаунт заради однієї коробки
 * саморізів — найдорожчий спосіб втратити покупця.
 *
 * Суму рахує сервер. Тут показуємо знімок із кошика й прямо про це кажемо.
 */

import { useCallback, useState } from "react";
import {
  ScrollView, View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { getToken } from "@/lib/auth-store";
import { getCart, clearCart, cartTotal, type CartItem } from "@/lib/cart";
import { colors, space, radius, formatUAH } from "@/theme";

export default function CheckoutScreen() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [delivery, setDelivery] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [contactName, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [useBolts, setUseBolts] = useState(false);

  /**
   * Профіль тягнемо тихо: гість оформлює замовлення без нього, і помилка
   * авторизації тут не має нічого блокувати — просто не буде блоку Болтів.
   */
  const { data: profile } = useQuery({
    queryKey: ["me", "checkout"],
    // Питаємо лише якщо токен узагалі є — інакше кожен гість отримував би 401,
    // а клієнт на 401 стирає токен: гість зайвий раз ходив би в мережу дарма.
    queryFn: async () => ((await getToken()) ? api.me() : null),
    retry: false,
  });

  const { data: config } = useQuery({ queryKey: ["config"], queryFn: api.config });

  useFocusEffect(
    useCallback(() => {
      getCart().then(setCart);
    }, [])
  );

  async function submit() {
    setBusy(true);
    try {
      const res = await api.createOrder({
        items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        contactName,
        phone,
        city: delivery === "DELIVERY" ? city : undefined,
        address: delivery === "DELIVERY" ? address : undefined,
        deliveryMethod: delivery,
        comment: comment || undefined,
        useBolts,
      });

      // Кошик чистимо тільки після успіху: на 409 «товар щойно розібрали»
      // людина має повернутись до свого ж кошика, а не до порожнього екрана.
      await clearCart();
      router.replace("/");
      Alert.alert(
        `Замовлення № ${res.orderNumber}`,
        "Дякуємо! Менеджер зателефонує найближчим часом для підтвердження."
      );
    } catch (e) {
      Alert.alert("Не вдалося оформити", e instanceof ApiError ? e.message : "Спробуйте ще раз");
    } finally {
      setBusy(false);
    }
  }

  if (cart.length === 0) {
    return <Text style={styles.hint}>Кошик порожній</Text>;
  }

  return (
    <>
      <Stack.Screen options={{ title: "Оформлення" }} />
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg }}>
        <Text style={styles.label}>Спосіб отримання</Text>
        <View style={styles.toggle}>
          {(["DELIVERY", "PICKUP"] as const).map((m) => (
            <Pressable
              key={m}
              style={[styles.toggleItem, delivery === m && styles.toggleOn]}
              onPress={() => setDelivery(m)}
            >
              <Text style={[styles.toggleText, delivery === m && styles.toggleTextOn]}>
                {m === "DELIVERY" ? "Доставка" : "Самовивіз"}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput style={styles.input} placeholder="Імʼя та прізвище" value={contactName}
          onChangeText={setName} placeholderTextColor={colors.textMuted} />
        <TextInput style={styles.input} placeholder="Телефон" value={phone} onChangeText={setPhone}
          keyboardType="phone-pad" placeholderTextColor={colors.textMuted} />

        {delivery === "DELIVERY" ? (
          <>
            <TextInput style={styles.input} placeholder="Місто" value={city} onChangeText={setCity}
              placeholderTextColor={colors.textMuted} />
            <TextInput style={styles.input} placeholder="Адреса або відділення" value={address}
              onChangeText={setAddress} placeholderTextColor={colors.textMuted} />
          </>
        ) : null}

        <TextInput style={[styles.input, styles.multiline]} placeholder="Коментар (необовʼязково)"
          value={comment} onChangeText={setComment} multiline placeholderTextColor={colors.textMuted} />

        {profile && profile.bolts.balance > 0 && config ? (
          <Pressable style={styles.boltsRow} onPress={() => setUseBolts((v) => !v)}>
            <View style={[styles.checkbox, useBolts && styles.checkboxOn]}>
              {useBolts ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.boltsLabel}>Списати Болти</Text>
              {/*
                Показуємо саме стелю, а не весь баланс: списати можна не більше
                частки від суми, і людина, що бачила «у вас 500», інакше
                вважала б, що заплатить ними все замовлення.
              */}
              <Text style={styles.boltsHint}>
                Доступно {Math.floor(
                  Math.min(profile.bolts.balance, cartTotal(cart) * config.boltsMaxUsageRate)
                )}{" "}
                з {Math.floor(profile.bolts.balance)} — до{" "}
                {Math.round(config.boltsMaxUsageRate * 100)}% суми
              </Text>
            </View>
          </Pressable>
        ) : null}

        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Позицій: {cart.length}</Text>
          <Text style={styles.summaryValue}>{formatUAH(cartTotal(cart))}</Text>
        </View>
        <Text style={styles.note}>
          Оплата при отриманні — готівкою або карткою. Передоплата не потрібна.
        </Text>

        <Pressable style={[styles.button, busy && styles.buttonOff]} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.buttonText}>Підтвердити замовлення</Text>
          )}
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: space.sm },
  toggle: { flexDirection: "row", gap: space.sm },
  toggleItem: {
    flex: 1,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  toggleOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  toggleText: { fontSize: 14, color: colors.text },
  toggleTextOn: { fontWeight: "700", color: colors.ink },
  input: {
    marginTop: space.md,
    paddingHorizontal: space.md,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 15,
    color: colors.text,
  },
  multiline: { height: 90, paddingTop: space.md, textAlignVertical: "top" },
  boltsRow: {
    marginTop: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkboxMark: { fontSize: 14, fontWeight: "800", color: colors.ink },
  boltsLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  boltsHint: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  summary: {
    marginTop: space.xl,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  summaryLabel: { fontSize: 14, color: colors.textMuted },
  summaryValue: { fontSize: 22, fontWeight: "800", color: colors.text },
  note: { marginTop: space.xs, fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  button: {
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  buttonOff: { opacity: 0.6 },
  buttonText: { fontSize: 15, fontWeight: "700", color: colors.ink },
  hint: { padding: space.lg, color: colors.textMuted, textAlign: "center" },
});
