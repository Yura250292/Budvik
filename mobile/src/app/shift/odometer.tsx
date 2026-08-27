/**
 * Показання одометра — фото, розпізнавання, підтвердження.
 *
 * Число завжди лишається редагованим, навіть коли AI впевнений. Одометр
 * знімають у машині, часто проти сонця, і помилка в одній цифрі — це помилка
 * в зарплаті водія; людина за кермом бачить прилад краще за будь-яку модель.
 *
 * Офлайн фото не рятує: розпізнавання — це виклик до сервера. Тому тут завжди
 * є шлях «ввести руками», і він же вмикається сам, коли мережі немає.
 */

import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { staffApi, StaffApiError } from "@/api/staff";
import { colors, space, radius } from "@/theme";
import { setPendingShift } from "@/track/pending-shift";
import { setShiftOpen } from "@/track/state";
import { endShiftTracking, startTracking, stopEverything } from "@/track/controller";

/** Фото звужуємо до 1280 px: сервер відхиляє завеликі, а більше й не потрібно. */
const PHOTO_WIDTH = 1280;
const PHOTO_QUALITY = 0.7;

export default function OdometerScreen() {
  const router = useRouter();
  const { phase } = useLocalSearchParams<{ phase?: string }>();
  const isClosing = phase === "END";

  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const [readId, setReadId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const capture = useCallback(async () => {
    if (!cameraRef.current) return;
    setBusy(true);
    setNote(null);
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!shot?.uri) throw new Error("Не вдалося зняти фото");

      const small = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: PHOTO_WIDTH } }],
        { compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
      );

      const form = new FormData();
      form.append("photo", {
        uri: small.uri,
        name: "odometer.jpg",
        type: "image/jpeg",
      } as unknown as Blob);
      form.append("phase", isClosing ? "END" : "START");

      const res = await staffApi.odometerRecognize(form);
      setReadId(res.readId ?? null);
      if (res.value != null) {
        setValue(String(res.value));
        setNote("Перевірте число — воно розпізнане з фото.");
      } else {
        setManual(true);
        setNote(res.message ?? "Не вдалося прочитати показання. Введіть їх самі.");
      }
    } catch (e) {
      /**
       * 422 сервер віддає, коли фото не схоже на одометр. Це не збій — це
       * привід перезняти або ввести руками, і саме так це й показуємо.
       */
      const msg = e instanceof StaffApiError ? e.message : "Немає зв’язку";
      setManual(true);
      setNote(`${msg}. Введіть показання самі — фото додасте пізніше.`);
    } finally {
      setBusy(false);
    }
  }, [isClosing]);

  const submit = useCallback(async () => {
    const odometer = Number(value.replace(/\D/g, ""));
    if (!Number.isInteger(odometer) || odometer < 100) {
      Alert.alert("Перевірте показання", "Введіть цілий кілометраж із приладу.");
      return;
    }

    setBusy(true);
    // Координати — необов'язкові: без мережі їх усе одно нікуди слати,
    // а зміну це блокувати не має.
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }).catch(() => null);

    const body = {
      odometer,
      source: readId && !manual ? "AI" : "MANUAL",
      readId: readId ?? undefined,
      lat: pos?.coords.latitude,
      lng: pos?.coords.longitude,
      /** Ключ на випадок ретраю: сервер за ним не створює другу зміну. */
      clientRequestId: Crypto.randomUUID(),
    };

    try {
      if (isClosing) {
        await staffApi.shiftClose(body);
        await setShiftOpen(false);
        /**
         * Після закриття не глушимо все, а ставимо коло навколо місця фінішу:
         * поки машина стоїть — процес спить, а щойно вона поїхала, запис
         * відновиться сам. Так і дорога додому не губиться, і батарея за ніч
         * не сідає.
         */
        await endShiftTracking();
      } else {
        await staffApi.shiftOpen(body);
        await setShiftOpen(true);
        await startTracking("SHIFT");
      }
      router.back();
    } catch (e) {
      const status = e instanceof StaffApiError ? e.status : 0;

      // 4xx — сервер не прийме цього ніколи (наприклад, показання менші за
      // попередні). Кажемо прямо, а не ховаємо запит у чергу назавжди.
      if (status >= 400 && status < 500 && status !== 429) {
        Alert.alert("Сервер не прийняв", e instanceof Error ? e.message : "Спробуйте ще раз");
        setBusy(false);
        return;
      }

      await setPendingShift({
        action: isClosing ? "close" : "open",
        odometer,
        source: "MANUAL",
        clientRequestId: body.clientRequestId,
        lat: body.lat,
        lng: body.lng,
        createdAt: Date.now(),
      });
      // Трек стартує одразу: людина вже на маршруті, і чекати на мережу,
      // щоб почати писати дорогу, немає жодного сенсу.
      if (isClosing) {
        await setShiftOpen(false);
        await endShiftTracking();
      } else {
        await setShiftOpen(true);
        await startTracking("SHIFT");
      }
      Alert.alert(
        "Немає зв’язку",
        "Показання збережено на пристрої — надішлемо самі, щойно з’явиться мережа. Маршрут уже пишеться."
      );
      router.back();
    } finally {
      setBusy(false);
    }
  }, [value, readId, manual, isClosing, router]);

  const title = isClosing ? "Одометр: кінець зміни" : "Одометр: початок зміни";

  if (!permission) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title }} />
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title }} />

      {!manual && permission.granted && (
        <View style={styles.cameraBox}>
          <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        </View>
      )}

      {!manual && !permission.granted && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Потрібна камера</Text>
          <Text style={styles.muted}>
            Фото одометра — підтвердження пробігу. Якщо камеру не дати, показання можна ввести
            руками, але офіс не зможе їх звірити.
          </Text>
          <Pressable style={styles.secondary} onPress={requestPermission}>
            <Text style={styles.secondaryText}>Дозволити камеру</Text>
          </Pressable>
        </View>
      )}

      {note && <Text style={styles.note}>{note}</Text>}

      {!manual && permission.granted && (
        <Pressable style={styles.button} onPress={capture} disabled={busy}>
          <Text style={styles.buttonText}>{busy ? "Розпізнаю…" : "Зняти одометр"}</Text>
        </Pressable>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Показання, км</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          keyboardType="number-pad"
          placeholder="напр. 184320"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <Text style={styles.muted}>
          Число завжди можна виправити — за приладом, а не за розпізнаванням.
        </Text>
      </View>

      <Pressable style={[styles.button, styles.dark]} onPress={submit} disabled={busy}>
        <Text style={styles.buttonTextLight}>
          {busy ? "Зберігаю…" : isClosing ? "Закрити зміну" : "Відкрити зміну"}
        </Text>
      </Pressable>

      {isClosing && (
        <Pressable
          style={styles.link}
          onPress={() => stopEverything().then(() => router.back())}
        >
          <Text style={styles.linkText}>Закрити зміну і зупинити запис зовсім</Text>
        </Pressable>
      )}

      {!manual && (
        <Pressable style={styles.link} onPress={() => setManual(true)}>
          <Text style={styles.linkText}>Ввести показання без фото</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md, backgroundColor: colors.surface, flexGrow: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  cameraBox: { height: 260, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.ink },
  camera: { flex: 1 },
  card: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  note: { fontSize: 14, color: colors.text, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    // 16 px, бо менший шрифт змушує систему масштабувати поле під час вводу.
    fontSize: 16,
    color: colors.text,
  },
  button: { padding: space.lg, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: "center" },
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
