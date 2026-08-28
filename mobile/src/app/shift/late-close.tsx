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
import { View, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { staffApi, StaffApiError, type LateCloseSuggestion } from "@/api/staff";
import { c, sp } from "@/ui/tokens";
import {
  Body,
  Button,
  Card,
  CardHead,
  CardTitle,
  Header,
  Note,
  Row,
  Screen,
} from "@/ui/kit";
import { setShiftOpen } from "@/track/state";
import { stopEverything } from "@/track/controller";
import { cancelCloseReminders } from "@/track/reminder";

export default function LateCloseScreen() {
  const router = useRouter();
  const [data, setData] = useState<LateCloseSuggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Мить, коли прочитано підказку: від неї міряється смуга часу. */
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await staffApi.lateCloseSuggestion());
      setNow(Date.now());
      setError(null);
    } catch (e) {
      // 409 — відкритої зміни немає. Це не помилка, а нормальна відповідь.
      /**
       * 409 — відкритої зміни немає, і це не помилка, а відповідь. Решту
       * показуємо словами сервера лише тоді, коли вони від сервера й прийшли:
       * «Failed to fetch» на екрані людини в машині не означає нічого.
       */
      const status = e instanceof StaffApiError ? e.status : 0;
      setError(
        status === 409
          ? "Відкритої зміни немає"
          : e instanceof StaffApiError
            ? e.message
            : "Немає зв’язку"
      );
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
      Alert.alert(
        "Зміну закрито",
        "Пробіг порахований за GPS — одометра за такий час уже не спитати."
      );
      router.back();
    } catch (e) {
      Alert.alert("Не вдалося", e instanceof Error ? e.message : "Спробуйте, коли буде зв’язок");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.bk} />
      </View>
    );
  }

  const sug = data?.suggestion;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Header title="Забув закрити зміну" eyebrow="Час — за треком, без фото" />

      <Screen>
        <Body>
          Ви доїхали додому й не закрили зміну. Якби закрити «зараз», дорога додому й ніч у дворі
          потрапили б у пробіг — тому час підказує трек.
        </Body>

        {!!error && (
          <Card tone="bad" gap={sp.xs}>
            <CardTitle>{error}</CardTitle>
            <Body>Якщо зміна все-таки відкрита — перевірте зв’язок і спробуйте ще раз.</Body>
          </Card>
        )}

        {data?.shift && (
          <Card gap={sp.xs}>
            <CardTitle>Зміна відкрита з {formatWhen(data.shift.startedAt)}</CardTitle>
            {data.shift.startOdometer != null && (
              <Note>Одометр на старті: {formatKm(data.shift.startOdometer)} км</Note>
            )}
          </Card>
        )}

        {sug && data?.shift ? (
          <Card tone="brand" gap={10}>
            <CardHead
              icon="map-pin-check"
              iconColor={c.good}
              title={`Схоже, ви закінчили о ${formatTime(sug.endedAt)}`}
            />
            <Body>
              Після цього машина простояла {Math.round(sug.stoodMinutes / 60) || "<1"} год і більше
              не рушила — тож це найімовірніший кінець роботи.
            </Body>

            {/* Смуга часу: скільки з відкритої зміни було роботою, а скільки
                вже стоянкою. Саме це співвідношення й вирішує людина. */}
            <Timeline startedAt={data.shift.startedAt} endedAt={sug.endedAt} now={now} />

            {sug.workKm != null && (
              <Row label="Робочий пробіг до цього часу" value={`${formatDec(sug.workKm)} км`} />
            )}
            {sug.afterWorkKm != null && sug.afterWorkKm > 0 && (
              <Row
                label="Після — дорога додому"
                value={`${formatDec(sug.afterWorkKm)} км`}
                tone="muted"
              />
            )}

            <Button
              tone="brand"
              icon="check"
              label={busy ? "Закриваю…" : `Так, закінчив о ${formatTime(sug.endedAt)}`}
              disabled={busy}
              onPress={() => close(sug.endedAt, "GPS")}
            />
            {/* Запасний варіант: підказка може бути хибною — наприклад, людина
                довго стояла на складі, а потім поїхала ще до двох клієнтів. */}
            <Button
              tone="outline"
              small
              label="Ні, працював до цієї хвилини"
              disabled={busy}
              onPress={() => close(new Date().toISOString(), "MANUAL")}
            />
          </Card>
        ) : (
          data?.shift && (
            <Card gap={sp.sm}>
              <CardHead icon="route-off" iconColor={c.warn} title="Трек не підказує час" />
              <Body>
                Довгої зупинки в записі немає — можливо, трек не писався. Закрийте зміну поточним
                часом, а якщо це не так, скажіть в офісі: виправити може лише офіс.
              </Body>
              <Button
                tone="brand"
                label={busy ? "Закриваю…" : "Закрити поточним часом"}
                disabled={busy}
                onPress={() => close(new Date().toISOString(), "MANUAL")}
              />
            </Card>
          )
        )}

        {!!data?.shift && (
          <Note>
            Пробіг цієї зміни буде за GPS — одометра за такий час уже не спитати. Показання на
            кінець порахуються зранку з фото наступної зміни.
          </Note>
        )}
      </Screen>
    </>
  );
}

/**
 * Робота і стоянка однією смугою.
 *
 * Пропорція справжня: від відкриття зміни до підказаного кінця — зелене, далі
 * до цієї хвилини — сіре. Число «простояла 3 год» саме по собі нічого не
 * важить, а поруч із робочим часом одразу видно, наскільки підказка розумна.
 */
function Timeline({ startedAt, endedAt, now }: { startedAt: string; endedAt: string; now: number }) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  const total = Math.max(1, now - start);
  const workFrac = Math.min(1, Math.max(0.05, (end - start) / total));

  return (
    <View style={s.timeline}>
      <View style={s.track}>
        <View style={[s.work, { flex: workFrac }]} />
        <View style={[s.home, { flex: Math.max(0.02, 1 - workFrac) }]} />
      </View>
      <View style={s.timeLabels}>
        <Text style={s.timeLabel}>{formatTime(startedAt)}</Text>
        <Text style={[s.timeLabel, s.timeStop]}>{formatTime(endedAt)} · стоп</Text>
        <Text style={s.timeLabel}>зараз</Text>
      </View>
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

function formatKm(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatDec(n: number): string {
  return String(n).replace(".", ",");
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  timeline: { gap: sp.xs, paddingVertical: 2 },
  track: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: c.line },
  work: { backgroundColor: c.good },
  home: { backgroundColor: c.text3 },
  timeLabels: { flexDirection: "row", justifyContent: "space-between" },
  timeLabel: { fontSize: 10, color: c.text3 },
  timeStop: { color: c.goodFg, fontWeight: "600" },
});
