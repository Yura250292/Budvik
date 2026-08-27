/**
 * Пізнє закриття зміни — коли людина згадала про неї вже вдома.
 *
 * Екран був у Kotlin-трекері, і без нього нова збірка гірша за стару. Випадок
 * не рідкісний: торговий закінчив об'їзд, поїхав додому й забув закрити зміну.
 * Якщо просто закрити її зараз, у пробіг потрапить дорога додому й ніч на
 * стоянці — тобто зайві кілометри в розрахунку.
 *
 * Тому час закінчення підказує сам трек: сервер шукає, коли машина стала й
 * більше не рушила. Людина цю підказку підтверджує або виправляє — рішення
 * лишається за нею, бо трек не знає, чи та зупинка була кінцем роботи.
 *
 * Фото одометра тут не питаємо навмисно: машина вже не поруч, і вимагати його
 * означало б штовхати людину вигадати число.
 */

import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { staffApi, StaffApiError, type LateCloseSuggestion } from "@/api/staff";
import { colors, space, radius } from "@/theme";
import { setShiftOpen } from "@/track/state";
import { stopEverything } from "@/track/controller";
import { cancelCloseReminders } from "@/track/reminder";

export default function LateCloseScreen() {
  const router = useRouter();
  const [data, setData] = useState<LateCloseSuggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await staffApi.lateCloseSuggestion());
      setError(null);
    } catch (e) {
      // 409 — відкритої зміни немає. Це не помилка, а нормальна відповідь.
      const status = e instanceof StaffApiError ? e.status : 0;
      setError(status === 409 ? "Відкритої зміни немає" : e instanceof Error ? e.message : "Немає зв’язку");
      setData(null);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const close = async (endedAt: string, source: "GPS" | "MANUAL") => {
    setBusy(true);
    try {
      await staffApi.lateClose({ endedAt, source });
      await setShiftOpen(false);
      await cancelCloseReminders();
      /**
       * Тут трек глушимо повністю, а не переводимо в режим «дорога додому»:
       * людина вже вдома, дописувати нічого.
       */
      await stopEverything();
      Alert.alert("Зміну закрито", "Пробіг порахований за GPS — одометра за такий час уже не спитати.");
      router.back();
    } catch (e) {
      Alert.alert("Не вдалося", e instanceof Error ? e.message : "Спробуйте, коли буде зв’язок");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Забув закрити зміну" }} />
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  const s = data?.suggestion;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: "Забув закрити зміну" }} />

      {error && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{error}</Text>
          <Text style={styles.muted}>
            Якщо зміна все-таки відкрита — перевірте зв’язок і спробуйте ще раз.
          </Text>
        </View>
      )}

      {data?.shift && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Зміна відкрита з {formatWhen(data.shift.startedAt)}</Text>
          {data.shift.startOdometer != null && (
            <Text style={styles.muted}>Одометр на старті: {data.shift.startOdometer} км</Text>
          )}
        </View>
      )}

      {s ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Схоже, ви закінчили о {formatTime(s.endedAt)}</Text>
          <Text style={styles.muted}>
            Після цього машина простояла {Math.round(s.stoodMinutes / 60) || "<1"} год і більше не
            рушила — тож це найімовірніший кінець роботи.
          </Text>
          {s.workKm != null && (
            <View style={styles.row}>
              <Text style={styles.muted}>Робочий пробіг до цього часу</Text>
              <Text style={styles.value}>{s.workKm} км</Text>
            </View>
          )}
          {s.afterWorkKm != null && s.afterWorkKm > 0 && (
            <View style={styles.row}>
              <Text style={styles.muted}>Після — дорога додому</Text>
              <Text style={styles.value}>{s.afterWorkKm} км</Text>
            </View>
          )}

          <Pressable style={styles.primary} onPress={() => close(s.endedAt, "GPS")} disabled={busy}>
            <Text style={styles.primaryText}>
              {busy ? "Закриваю…" : `Так, закінчив о ${formatTime(s.endedAt)}`}
            </Text>
          </Pressable>

          {/* Запасний варіант: підказка може бути хибною — наприклад, людина
              довго стояла на складі, а потім поїхала ще до двох клієнтів. */}
          <Pressable
            style={styles.secondary}
            onPress={() => close(new Date().toISOString(), "MANUAL")}
            disabled={busy}
          >
            <Text style={styles.secondaryText}>Ні, працював до цієї хвилини</Text>
          </Pressable>
        </View>
      ) : (
        data?.shift && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Трек не підказує час</Text>
            <Text style={styles.muted}>
              Довгої зупинки в записі немає — можливо, трек не писався. Закрийте зміну поточним
              часом, а якщо це не так, скажіть в офісі: виправити може лише вони.
            </Text>
            <Pressable
              style={styles.primary}
              onPress={() => close(new Date().toISOString(), "MANUAL")}
              disabled={busy}
            >
              <Text style={styles.primaryText}>{busy ? "Закриваю…" : "Закрити поточним часом"}</Text>
            </Pressable>
          </View>
        )
      )}
    </ScrollView>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("uk-UA", {
      timeZone: "Europe/Kyiv",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("uk-UA", {
      timeZone: "Europe/Kyiv",
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

const styles = StyleSheet.create({
  page: { padding: space.md, gap: space.md, backgroundColor: colors.surface, flexGrow: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  muted: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  value: { fontSize: 14, fontWeight: "600", color: colors.text },
  primary: {
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  primaryText: { fontWeight: "700", color: colors.ink, fontSize: 15 },
  secondary: {
    marginTop: space.xs,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  secondaryText: { fontWeight: "600", color: colors.text, fontSize: 14 },
});
