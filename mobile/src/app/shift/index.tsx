/**
 * Зміна: відкрити, закрити, побачити стан треку.
 *
 * Екран навмисно вузький. Уся решта роботи торгового живе в кабінеті (сайт у
 * WebView), а тут — тільки те, чого сайт зробити не може: фонова геолокація,
 * дозволи системи й буфер точок, який лежить на самому пристрої.
 */

import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { staffApi, type ShiftState } from "@/api/staff";
import { colors, space, radius } from "@/theme";
import { bufferedCount } from "@/track/db";
import { isTracking, startTracking, stopEverything } from "@/track/controller";
import { getPendingShift, type PendingShift } from "@/track/pending-shift";
import {
  askIgnoreBatteryOptimizations,
  currentPermissions,
  requestTrackingPermissions,
  type PermissionState,
} from "@/track/permissions";
import { flush } from "@/track/uploader";
import { setShiftOpen } from "@/track/state";
import { registerWatchdog } from "@/track/watchdog";

export default function ShiftScreen() {
  const router = useRouter();
  const [state, setState] = useState<ShiftState | null>(null);
  const [pending, setPending] = useState<PendingShift | null>(null);
  const [perms, setPerms] = useState<PermissionState | null>(null);
  const [tracking, setTracking] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [p, t, b, q] = await Promise.all([
      currentPermissions(),
      isTracking(),
      bufferedCount(),
      getPendingShift(),
    ]);
    setPerms(p);
    setTracking(t);
    setBuffered(b);
    setPending(q);

    try {
      const s = await staffApi.shiftCurrent();
      setState(s);
      await setShiftOpen(!!s.shift);
    } catch {
      /**
       * Немає зв'язку — це нормальний стан на маршруті, а не помилка.
       * Показуємо те, що знаємо локально: трек від мережі не залежить.
       */
      setState(null);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const open = async () => {
    const granted = perms?.foreground ? perms : await requestTrackingPermissions();
    setPerms(granted);
    if (!granted.foreground) {
      Alert.alert(
        "Потрібен доступ до геолокації",
        "Без нього маршрут не пишеться. Дозвольте доступ у налаштуваннях застосунку."
      );
      return;
    }
    if (!granted.background) {
      Alert.alert(
        "Оберіть «Дозволяти завжди»",
        "Варіант «Тільки під час використання» зупиняє запис, щойно екран гасне. Відкрийте дозволи застосунку й оберіть «Дозволяти завжди»."
      );
    }
    router.push("/shift/odometer?phase=START");
  };

  const close = () => router.push("/shift/odometer?phase=END");

  const sendNow = async () => {
    setBusy(true);
    await flush().catch(() => {});
    await refresh();
    setBusy(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Зміна" }} />
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  const shift = state?.shift ?? null;
  const shiftOpen = !!shift || pending?.action === "open";

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: "Зміна" }} />

      {/* Відкладений запит видно окремо: людина мусить розуміти, що кнопку
          натиснуто, просто мережа ще не з'явилася. */}
      {pending && (
        <View style={[styles.card, styles.warn]}>
          <Text style={styles.cardTitle}>
            {pending.action === "open" ? "Відкриття чекає мережі" : "Закриття чекає мережі"}
          </Text>
          <Text style={styles.muted}>
            Одометр {pending.odometer} км збережено на пристрої. Надішлемо самі, щойно з’явиться
            зв’язок — тикати кнопку ще раз не треба.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{shiftOpen ? "Зміна відкрита" : "Зміна закрита"}</Text>
        {shift && (
          <>
            <Row label="Початок" value={formatTime(shift.startedAt)} />
            <Row label="Одометр на старті" value={shift.startOdometer ? `${shift.startOdometer} км` : "—"} />
            <Row label="За GPS" value={shift.gpsDistanceKm != null ? `${shift.gpsDistanceKm} км` : "—"} />
            <Row label="Триває" value={shift.hoursOpen != null ? `${shift.hoursOpen} год` : "—"} />
          </>
        )}
        {!shift && state?.previous?.endOdometer != null && (
          <Row label="Одометр минулої зміни" value={`${state.previous.endOdometer} км`} />
        )}
        {shift?.shouldRemindToClose && (
          <Text style={[styles.muted, { color: colors.sale, marginTop: space.sm }]}>
            Зміна триває надто довго. Якщо ви вже вдома — закрийте її, поки її не визнали забутою.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Маршрут</Text>
        <Row label="Запис" value={tracking ? "іде" : "не йде"} />
        <Row label="Не надіслано точок" value={String(buffered)} />
        {buffered > 0 && (
          <Pressable style={styles.secondary} onPress={sendNow} disabled={busy}>
            <Text style={styles.secondaryText}>{busy ? "Надсилаю…" : "Надіслати зараз"}</Text>
          </Pressable>
        )}
        {perms && !perms.background && (
          <Text style={[styles.muted, { marginTop: space.sm }]}>
            Дозвіл «Завжди» не виданий — запис зупиниться, коли екран згасне.
          </Text>
        )}
        <Pressable style={styles.link} onPress={askIgnoreBatteryOptimizations}>
          <Text style={styles.linkText}>Не обмежувати батарею для застосунку</Text>
        </Pressable>
      </View>

      {shiftOpen ? (
        <Pressable style={[styles.button, styles.dark]} onPress={close}>
          <Text style={styles.buttonTextLight}>Закрити зміну</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.button} onPress={open}>
          <Text style={styles.buttonText}>Відкрити зміну</Text>
        </Pressable>
      )}

      {/* Сторож реєструється тут, а не при запуску: він потрібен лише тому,
          хто справді користується змінами, і питати систему про фонові
          завдання у покупця немає підстав. */}
      <Pressable
        style={styles.link}
        onPress={async () => {
          await registerWatchdog();
          await refresh();
        }}
      >
        <Text style={styles.linkText}>Перевірити фонову службу</Text>
      </Pressable>

      <Pressable style={styles.link} onPress={() => router.push("/shift/history")}>
        <Text style={styles.linkText}>Історія змін</Text>
      </Pressable>

      {/* Вихід на пізнє закриття показуємо лише коли він потрібен: зміна
          відкрита довше за робочий день. Кнопка «забув закрити» на очах у
          того, хто нічого не забув, лише плутає. */}
      {shift?.shouldRemindToClose && (
        <Pressable style={styles.link} onPress={() => router.push("/shift/late-close")}>
          <Text style={styles.linkText}>Забув закрити — порахувати за треком</Text>
        </Pressable>
      )}

      {tracking && !shiftOpen && (
        <Pressable style={styles.link} onPress={() => stopEverything().then(refresh)}>
          <Text style={styles.linkText}>Зупинити запис маршруту</Text>
        </Pressable>
      )}
      {!tracking && shiftOpen && (
        <Pressable style={styles.link} onPress={() => startTracking("SHIFT").then(refresh)}>
          <Text style={styles.linkText}>Увімкнути запис маршруту</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
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

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md, backgroundColor: colors.surface, flexGrow: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  warn: { borderWidth: 1, borderColor: colors.brand },
  cardTitle: { fontSize: 17, fontWeight: "700", color: colors.text, marginBottom: space.xs },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  muted: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  value: { fontSize: 14, fontWeight: "600", color: colors.text },
  button: {
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  dark: { backgroundColor: colors.ink },
  buttonText: { fontWeight: "700", color: colors.ink, fontSize: 15 },
  buttonTextLight: { fontWeight: "700", color: "#FFFFFF", fontSize: 15 },
  secondary: {
    marginTop: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  secondaryText: { fontWeight: "600", color: colors.text, fontSize: 14 },
  link: { paddingVertical: space.sm, alignItems: "center" },
  linkText: { color: colors.textMuted, fontSize: 13, textDecorationLine: "underline" },
});
