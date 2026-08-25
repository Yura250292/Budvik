/**
 * Кабінет: вхід або профіль.
 *
 * Купувати можна й без акаунта — гостьове замовлення працює наскрізь, — тож
 * цей екран нічого не вимагає й нікуди не редіректить. Акаунт дає Болти,
 * історію замовлень і збережене обране; це пропозиція, а не турнікет.
 */

import { useCallback, useState } from "react";
import {
  ScrollView, View, Text, TextInput, Pressable, StyleSheet, Alert, Switch, ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, ApiError } from "@/api/client";
import {
  getToken, setToken, clearToken, setScope, isBiometricEnabled, isBiometricAvailable, setBiometric,
} from "@/lib/auth-store";
import { registerForPush, unregisterPush } from "@/lib/push";
import { colors, space, radius, formatUAH } from "@/theme";

type Profile = Awaited<ReturnType<typeof api.me>>;

export default function AccountScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [biometric, setBio] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (await getToken()) setProfile(await api.me());
      else setProfile(null);
    } catch {
      // 401 клієнт уже обробив — токен стерто, лишається екран входу.
      setProfile(null);
    }
    setBio(await isBiometricEnabled());
    setBioAvailable(await isBiometricAvailable());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function submit() {
    setBusy(true);
    try {
      if (mode === "login") {
        const res = await api.login(email.trim(), password);
        await setToken(res.token);
        await setScope(res.scope);
        setPassword("");

        /**
         * Працівник — не в магазин.
         *
         * Область ухвалює сервер у місці видачі токена, і застосунок її не
         * переоцінює. Track-токен усі роути /api/v1/* відхиляють, тож без
         * цього розведення торговий побачив би порожній магазин і вирішив,
         * що застосунок зламався.
         */
        if (res.scope === "track") {
          router.replace({ pathname: "/cabinet", params: { target: res.target ?? "/sales" } });
          return;
        }

        await load();
        registerForPush().catch(() => {});
        return;
      }

      const res = await api.register({
        email: email.trim(),
        password,
        name: name.trim(),
        phone,
      });
      await setToken(res.token);
      await setScope("shop");
      setPassword("");
      await load();

      /**
       * Дозвіл на сповіщення питаємо тут, а не при першому запуску: людині,
       * яка щойно завела акаунт у магазині, зрозуміло, про що її сповіщатимуть.
       * На холодному старті це питання без контексту, і на iOS відмову вже
       * не перепитати.
       */
      registerForPush().catch(() => {});
    } catch (e) {
      Alert.alert("Не вдалося", e instanceof ApiError ? e.message : "Спробуйте ще раз");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    // Спершу сервер, потім пристрій: якщо мережі немає, токен усе одно треба
    // стерти локально — інакше «вихід» нічого не робить.
    // Спершу відписка від пушів: після стирання токена запит уже не пройде,
    // і чужі замовлення приходили б на цей телефон.
    await unregisterPush();
    await api.logout().catch(() => {});
    await clearToken();
    setProfile(null);
  }

  /**
   * Видалення акаунта.
   *
   * Власне поле, а не Alert.prompt: той існує лише на iOS, і на Android кнопка
   * мовчки нічого не робила б — тобто вимога магазину про видалення акаунта
   * усередині застосунку була б порушена рівно на половині пристроїв.
   */
  async function doDelete() {
    setBusy(true);
    try {
      await api.deleteAccount(deletePassword);
      await clearToken();
      setProfile(null);
      setDeleting(false);
      setDeletePassword("");
      Alert.alert("Акаунт видалено", "Замовлення, які вже в роботі, ми довеземо.");
    } catch (e) {
      Alert.alert("Не вдалося", e instanceof ApiError ? e.message : "Спробуйте ще раз");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <ActivityIndicator style={{ marginTop: space.xl }} color={colors.ink} />;

  if (!profile) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg }}>
        <Text style={styles.title}>{mode === "login" ? "Вхід" : "Реєстрація"}</Text>

        {mode === "register" ? (
          <TextInput style={styles.input} placeholder="Імʼя" value={name} onChangeText={setName}
            placeholderTextColor={colors.textMuted} />
        ) : null}

        <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail}
          autoCapitalize="none" keyboardType="email-address" placeholderTextColor={colors.textMuted} />
        <TextInput style={styles.input} placeholder="Пароль" value={password} onChangeText={setPassword}
          secureTextEntry placeholderTextColor={colors.textMuted} />

        {mode === "register" ? (
          <TextInput style={styles.input} placeholder="Телефон" value={phone} onChangeText={setPhone}
            keyboardType="phone-pad" placeholderTextColor={colors.textMuted} />
        ) : null}

        <Pressable style={[styles.button, busy && styles.buttonOff]} onPress={submit} disabled={busy}>
          <Text style={styles.buttonText}>
            {busy ? "Хвилинку…" : mode === "login" ? "Увійти" : "Зареєструватися"}
          </Text>
        </Pressable>

        <Pressable onPress={() => setMode(mode === "login" ? "register" : "login")}>
          <Text style={styles.link}>
            {mode === "login" ? "Немає акаунта? Зареєструватися" : "Уже маю акаунт"}
          </Text>
        </Pressable>

        <Text style={styles.note}>
          Замовити можна й без акаунта. Акаунт дає Болти — 5% кешбеку з кожного замовлення.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg }}>
      <Text style={styles.title}>{profile.user.name}</Text>
      <Text style={styles.muted}>{profile.user.email}</Text>

      <View style={styles.bolts}>
        <Text style={styles.boltsLabel}>Болти</Text>
        <Text style={styles.boltsValue}>{formatUAH(profile.bolts.balance)}</Text>
      </View>

      {profile.bolts.transactions.slice(0, 5).map((t) => (
        <View key={t.id} style={styles.txn}>
          <Text style={styles.txnText} numberOfLines={1}>{t.description}</Text>
          <Text style={[styles.txnAmount, t.amount < 0 && { color: colors.sale }]}>
            {t.amount > 0 ? "+" : ""}{t.amount}
          </Text>
        </View>
      ))}

      <View style={styles.menu}>
        <MenuRow icon="receipt-outline" label="Мої замовлення" onPress={() => router.push("/orders")} />
        <MenuRow icon="heart-outline" label="Обране" onPress={() => router.push("/wishlist")} />
      </View>

      {bioAvailable ? (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Вхід за відбитком або Face ID</Text>
          <Switch
            value={biometric}
            onValueChange={async (v) => {
              const ok = await setBiometric(v);
              setBio(ok ? v : biometric);
            }}
            trackColor={{ true: colors.brand }}
          />
        </View>
      ) : null}

      <Pressable style={styles.buttonOutline} onPress={logout}>
        <Text style={styles.buttonOutlineText}>Вийти</Text>
      </Pressable>

      {deleting ? (
        <View style={styles.deleteBox}>
          <Text style={styles.deleteTitle}>Видалити акаунт назавжди?</Text>
          <Text style={styles.deleteText}>
            Болти згорять, обране зникне. Замовлення, які вже в роботі, ми довеземо —
            менеджер бачить контакти, які ви лишили при оформленні.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Пароль для підтвердження"
            value={deletePassword}
            onChangeText={setDeletePassword}
            secureTextEntry
            placeholderTextColor={colors.textMuted}
          />
          <Pressable style={[styles.dangerButton, busy && styles.buttonOff]} onPress={doDelete} disabled={busy}>
            <Text style={styles.dangerButtonText}>Так, видалити</Text>
          </Pressable>
          <Pressable style={styles.danger} onPress={() => { setDeleting(false); setDeletePassword(""); }}>
            <Text style={styles.link}>Скасувати</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.danger} onPress={() => setDeleting(true)}>
          <Text style={styles.dangerText}>Видалити акаунт</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <Ionicons name={icon} size={20} color={colors.ink} />
      <Text style={styles.menuLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  muted: { marginTop: 2, color: colors.textMuted, fontSize: 13 },
  input: {
    marginTop: space.md,
    paddingHorizontal: space.md,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 15,
    color: colors.text,
  },
  button: {
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  buttonOff: { opacity: 0.6 },
  buttonText: { fontSize: 15, fontWeight: "700", color: colors.ink },
  link: { marginTop: space.lg, textAlign: "center", color: colors.textMuted, fontSize: 13 },
  note: { marginTop: space.xl, textAlign: "center", color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  bolts: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  boltsLabel: { color: "#D1D5DB", fontSize: 13 },
  boltsValue: { marginTop: space.xs, color: colors.brand, fontSize: 26, fontWeight: "800" },
  txn: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  txnText: { flex: 1, fontSize: 13, color: colors.text },
  txnAmount: { fontSize: 13, fontWeight: "700", color: colors.ok },
  menu: { marginTop: space.lg },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuLabel: { flex: 1, fontSize: 15, color: colors.text },
  switchRow: {
    marginTop: space.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchLabel: { flex: 1, fontSize: 14, color: colors.text },
  buttonOutline: {
    marginTop: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  buttonOutlineText: { fontSize: 15, fontWeight: "600", color: colors.text },
  danger: { marginTop: space.lg, paddingVertical: space.sm, alignItems: "center" },
  dangerText: { fontSize: 13, color: colors.sale },
  deleteBox: {
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.sale,
  },
  deleteTitle: { fontSize: 15, fontWeight: "700", color: colors.sale },
  deleteText: { marginTop: space.sm, fontSize: 13, lineHeight: 18, color: colors.text },
  dangerButton: {
    marginTop: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.sale,
    alignItems: "center",
  },
  dangerButtonText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
});
