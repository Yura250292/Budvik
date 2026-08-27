/**
 * Зміна: відкрити, закрити, побачити стан треку.
 *
 * Екран навмисно вузький. Уся решта роботи торгового живе в кабінеті (сайт у
 * WebView), а тут — тільки те, чого сайт зробити не може: фонова геолокація,
 * дозволи системи й буфер точок, який лежить на самому пристрої.
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  TextInput,
} from "react-native";
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

      {/*
        Звірка вчорашньої зміни — над усім іншим.
        Зміну закрив сервер або офіс, і поки людина не сказала «так
        було», кілометри в ній стоять на здогадці треку. Показуємо це
        першим, бо саме ранкове фото одометра щойно дало число: якщо
        картка буде третьою, її прогорнуть і не побачать.
      */}
      {state?.needsConfirmation && (
        <ConfirmCard
          data={state.needsConfirmation}
          onDone={refresh}
        />
      )}

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

/**
 * Картка «підтвердіть учорашню зміну».
 *
 * Три відповіді, і всі три закривають питання: згода, справжній
 * одометр, «я ще працював». Четвертої — промовчати — немає навмисно:
 * поки людина не відповіла, зміна висить у черзі й у неї, і в офіса.
 *
 * Одометр питаємо числом, а не фото: машина вже не поруч, і на приладі
 * давно інше значення. Вимога фото штовхала б вигадати кадр.
 */
function ConfirmCard({
  data,
  onDone,
}: {
  data: NonNullable<ShiftState["needsConfirmation"]>;
  onDone: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const run = async (action: () => Promise<unknown>, failTitle: string) => {
    setBusy(true);
    try {
      await action();
      await onDone();
    } catch (e) {
      Alert.alert(failTitle, e instanceof Error ? e.message : "Спробуйте, коли буде зв’язок");
    } finally {
      setBusy(false);
    }
  };

  const when = data.endedAt ? formatTime(data.endedAt) : "невідомо коли";
  const auto = data.closedAutomatically;

  return (
    <View style={[styles.card, styles.warn]}>
      <Text style={styles.cardTitle}>
        {auto ? `Зміну закрито автоматично о ${when}` : `Зміна закрита о ${when}`}
      </Text>
      <Text style={styles.muted}>
        {data.lateCloseSource === "AUTO_DEAD"
          ? "Маршрут перестав писатися, тому час узято з останньої точки. Перевірте його."
          : data.lateCloseSource === "AUTO_FORCED"
            ? "Машина ще рухалась, але зміна тривала надто довго — час закриття приблизний."
            : data.lateCloseSource === "AUTO_GAP"
              ? "Маршрут писався з розривом: планшет замовк і озвався вже на місці. Робота могла скінчитися РАНІШЕ за цей час — якщо так, виправте його в офісі."
              : "Час узято з треку: після нього машина стала й більше не рушила."}
      </Text>

      {data.distanceKm != null && (
        <Row label="Пробіг за одометром" value={`${data.distanceKm} км`} />
      )}
      {data.gpsDistanceKm != null && <Row label="За GPS" value={`${data.gpsDistanceKm} км`} />}
      {data.afterWorkKm != null && data.afterWorkKm > 0 && (
        <Row label="Дорога додому (відняті)" value={`${data.afterWorkKm} км`} />
      )}
      {data.endOdometer == null && (
        <Text style={[styles.muted, { marginTop: space.xs }]}>
          Одометр на кінець роботи ще невідомий — він порахується з фото наступної зміни.
        </Text>
      )}

      {editing ? (
        <>
          <TextInput
            value={value}
            onChangeText={setValue}
            keyboardType="number-pad"
            placeholder={`більше за ${data.startOdometer}`}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <Pressable
            style={styles.button}
            disabled={busy}
            onPress={() => {
              const n = Number(value.replace(/\D/g, ""));
              if (!Number.isInteger(n) || n < data.startOdometer) {
                Alert.alert(
                  "Перевірте показання",
                  `Одометр на кінець не може бути меншим за стартовий (${data.startOdometer} км).`
                );
                return;
              }
              void run(() => staffApi.shiftConfirm(data.shiftId, { endOdometer: n }), "Не прийнято");
            }}
          >
            <Text style={styles.buttonText}>{busy ? "Зберігаю…" : "Зберегти одометр"}</Text>
          </Pressable>
          <Pressable style={styles.link} onPress={() => setEditing(false)}>
            <Text style={styles.linkText}>Скасувати</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            style={styles.button}
            disabled={busy}
            onPress={() => void run(() => staffApi.shiftConfirm(data.shiftId, { ok: true }), "Не прийнято")}
          >
            <Text style={styles.buttonText}>{busy ? "Надсилаю…" : "Все вірно"}</Text>
          </Pressable>

          <Pressable style={styles.link} onPress={() => setEditing(true)}>
            <Text style={styles.linkText}>Вказати одометр на кінець роботи</Text>
          </Pressable>

          {/* Повернення в роботу — лише поки сервер його приймає: це
              виправлення свіжої помилки, а не спосіб переписати день. */}
          {data.canReopen && (
            <Pressable
              style={styles.link}
              disabled={busy}
              onPress={() =>
                void run(() => staffApi.shiftReopen(data.shiftId), "Не вдалося відновити")
              }
            >
              <Text style={styles.linkText}>Я ще працював — відновити зміну</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
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
  input: {
    marginTop: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    // 16 px: менший шрифт змушує систему масштабувати поле під час вводу.
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  link: { paddingVertical: space.sm, alignItems: "center" },
  linkText: { color: colors.textMuted, fontSize: 13, textDecorationLine: "underline" },
});
