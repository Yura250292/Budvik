/**
 * Показання одометра — фото, розпізнавання, підтвердження.
 *
 * Число завжди лишається редагованим, навіть коли AI впевнений. Одометр
 * знімають у машині, часто проти сонця, і помилка в одній цифрі — це помилка
 * в зарплаті водія; людина за кермом бачить прилад краще за будь-яку модель.
 *
 * Офлайн фото не рятує: розпізнавання — це виклик до сервера. Тому тут завжди
 * є шлях «ввести руками», і він же вмикається сам, коли мережі немає.
 *
 * Верстка з макета: рамка на видошукачі («наведіть на ODO, не TRIP») і
 * розпізнані цифри поодинці. Обидва елементи — не прикраса: перша ловить
 * найчастішу помилку зйомки, другі показують, ЯКЕ саме число підставлено, до
 * того як людина натисне «Відкрити зміну».
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { useQueryClient } from "@tanstack/react-query";
import { staffApi, StaffApiError, type OdometerRecognized, type ShiftState } from "@/api/staff";
import { staffKeys } from "@/api/staff-queries";
import { formatTime } from "@/lib/format-date";
import { c, r } from "@/ui/tokens";
import {
  Body,
  BigInput,
  Button,
  Callout,
  Card,
  CardTitle,
  Header,
  Note,
  Row,
  Screen,
  TextLink,
} from "@/ui/kit";
import { within } from "@/lib/within";
import { flush, heartbeat } from "@/track/uploader";
import { setPendingShift } from "@/track/pending-shift";
import { setShiftOpen } from "@/track/state";
import { endShiftTracking, startTracking, stopEverything } from "@/track/controller";
import { isTaskRegistered } from "@/track/health";
import { cancelCloseReminders, scheduleCloseReminders } from "@/track/reminder";

/** Фото звужуємо до 1280 px: сервер відхиляє завеликі, а більше й не потрібно. */
const PHOTO_WIDTH = 1280;
const PHOTO_QUALITY = 0.7;

/**
 * Скільки чекаємо на злив буфера перед закриттям зміни.
 *
 * Двадцять секунд — це десяток пачок на живій мережі, тобто будь-який
 * реальний денний хвіст. Не встигли — закриваємо однаково: хвіст доїде
 * пізніше, а погодинний перерахунок (`src/lib/shift/recount.ts`) виправить
 * число в картці. Тримати людину на вертушці довше немає за що.
 */
const CLOSE_FLUSH_MS = 20_000;

/**
 * Скільки чекаємо на пульс, яким зміна звітує про себе відразу.
 *
 * Десять секунд, і людина справді їх чекає — але заплатить за них хіба в
 * теорії. До цього рядка доходять лише ПІСЛЯ вдалого запиту на відкриття чи
 * закриття зміни, тобто мережа щойно довела, що жива, а пульс — це кілобайт
 * проти фотографії одометра. На мертвій мережі сюди не доходять узагалі:
 * зміна лягає у відкладені й екран закривається раніше.
 *
 * Не встиг — не біда, наступний піде своїм ходом; тримати вертушку довше
 * заради довідки не можна.
 */
const STATE_BEAT_MS = 10_000;

/**
 * Звірити запис зі СПИСКОМ СИСТЕМИ — і саме на цьому екрані.
 *
 * Торговий відкриває цей застосунок двічі на день: вранці, щоб відкрити зміну
 * з фото одометра, і ввечері, щоб її закрити. Решту дня він працює в іншій
 * програмі, а ми у фоні. Тобто це єдина мить, коли Android дозволяє все і
 * людина ще поруч — іншої нагоди підняти запис за день не буде.
 *
 * `startTracking` повертає успіх, коли виклик не кинув винятку. Але система
 * могла завдання не взяти — а expo-task-manager ще й знімає реєстрацію САМ,
 * коли headless-рушій JS не піднімається (TaskService.java: «Host
 * unreachable? Unregister all tasks for that app»). Тоді прапорець «пишемо»
 * стоятиме піднятий цілий день над мертвим треком.
 *
 * `getRegisteredTasksAsync` — єдина перевірка, яка цього не приховує. Не
 * взяло — пробуємо ще раз, поки ми на передньому плані й маємо право.
 */
async function verifyTaskRegistered(): Promise<void> {
  try {
    if ((await isTaskRegistered()) === false) {
      await startTracking("SHIFT", { force: true });
    }
  } catch {
    /* перевірка не має права завалити відкриття зміни */
  }
}

export default function OdometerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  /**
   * Зміна щойно змінилася — кеш екранів, які її показують, більше не дійсний.
   *
   * Без цього людина повертається з одометра на екран зміни й бачить там стан
   * до відкриття: картка каже «зміну не відкрито», хоча трек уже пишеться.
   */
  const invalidateShift = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: staffKeys.shiftCurrent });
    queryClient.invalidateQueries({ queryKey: staffKeys.day });
  }, [queryClient]);
  const { phase } = useLocalSearchParams<{ phase?: string }>();
  const isClosing = phase === "END";

  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const [readId, setReadId] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<OdometerRecognized | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [shift, setShift] = useState<ShiftState["shift"]>(null);

  /**
   * Стан зміни потрібен лише при закритті — щоб показати, ЩО вийде за день,
   * поки число ще можна виправити. Мовчазний catch навмисно: без мережі
   * закрити зміну все одно можна, просто без підсумку.
   */
  useEffect(() => {
    if (!isClosing) return;
    staffApi
      .shiftCurrent()
      .then((s) => setShift(s.shift))
      .catch(() => {});
  }, [isClosing]);

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
      setRecognized(res);

      if (res.ai.value != null) {
        setValue(String(res.ai.value));
        /**
         * Навіть коли вердикт «не ок» (добовий лічильник, число менше за
         * стартове), число підставляємо: виправити одну цифру швидше, ніж
         * набрати шість. Але поле відкриваємо на редагування й кажемо чому.
         */
        if (!res.verdict.ok) {
          setManual(true);
          setNote(res.verdict.message ?? "Перевірте число — воно виглядає дивно.");
        }
      } else {
        setManual(true);
        setNote(
          res.verdict.message ?? res.ai.reason ?? "Не вдалося прочитати показання. Введіть їх самі."
        );
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
    let closeWarning: string | null = null;
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
        /**
         * Спершу віддати буфер — і аж ПОТІМ закривати зміну.
         *
         * Пробіг за треком сервер рахує рівно в мить закриття, з тих точок,
         * які має на той момент. А злив буфера стояв нижче, в
         * `endShiftTracking`, тобто вже після рахунку: усе, що лежало в
         * планшеті, приїжджало в закриту зміну із запізненням.
         *
         * 10.09 у Кулика день закрився з «156 км по одометру, 111 по
         * трекеру»: точки з 14:31 і далі ще лежали в планшеті. Число пішло
         * власникові в Telegram як факт, і саме воно виглядало як поламаний
         * трек, хоч трек був цілий. Погодинний перерахунок виправляє картку,
         * але повідомлення про закриття не переписує ніхто — його читають
         * один раз.
         *
         * Межа часу тут обов'язкова: закриття не має залежати від того, чи є
         * зв'язок у селі. Не встигли — закриваємо з тим, що доїхало.
         */
        await within(flush(true), CLOSE_FLUSH_MS, undefined);
        const res = await staffApi.shiftClose(body);
        // Трек не сходиться з одометром — сказати зараз, поки людина ще
        // пам'ятає число на табло. Зміна вже закрита: це не перепона.
        if (res?.warning) closeWarning = res.warning;
        await setShiftOpen(false);
        await cancelCloseReminders();
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
        // Нагадування ставимо на вечір цього ж дня: до 20:00, коли за
        // зміну візьметься сервер, людина ще може закрити її сама — з
        // фото й чесним одометром.
        await scheduleCloseReminders();
        await startTracking("SHIFT");
        await verifyTaskRegistered();
      }

      /**
       * Пульс — тут, з переднього плану, і силоміць.
       *
       * НАЙДОРОЖЧА СЛІПА ПЛЯМА, яку видно з сервера. Пульс шлють рекордер
       * (коли служба принесла фікси) і сторож (раз на чверть години, якщо
       * система його взагалі підняла). На зламаному планшеті не працює ні
       * перше, ні друге — тобто єдиний канал діагностики помирає РАЗОМ із
       * тим, що він мав діагностувати.
       *
       * 11.09.2026 Олександр відкрив зміну о 07:28, і через півгодини сервер
       * усе ще мав від його планшета лише вчорашній пульс о 17:08 із
       * `mode=NONE`. Тобто на питання «чи пішов трек» не було відповіді
       * взагалі — ні «так», ні «ні», ні причини. А відповідати треба поки
       * людина ще біля машини й може щось зробити.
       *
       * Відкриття й закриття зміни — єдина мить, коли застосунок ГАРАНТОВАНО
       * на передньому плані: людина щойно ввела показання одометра. Саме там
       * запит проходить завжди, і саме там ми досі не питали нічого.
       *
       * `force`, бо звичайний пульс має межу в три хвилини й тихо повернув би
       * null — а цей потрібен не за розкладом, а за подією. І під межею часу:
       * довідка не має права затримувати зміну.
       */
      await within(heartbeat(true), STATE_BEAT_MS, null);

      invalidateShift();
      if (closeWarning) {
        Alert.alert("Перевірте одометр", closeWarning, [
          { text: "Зрозуміло", onPress: () => router.back() },
        ]);
        return;
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
        await cancelCloseReminders();
        await endShiftTracking();
      } else {
        await setShiftOpen(true);
        // Запит іще в черзі, але зміна для людини вже почалася —
        // нагадування живе на пристрої й мережі не потребує.
        await scheduleCloseReminders();
        await startTracking("SHIFT");
        await verifyTaskRegistered();
      }
      Alert.alert(
        "Немає зв’язку",
        "Показання збережено на пристрої — надішлемо самі, щойно з’явиться мережа. Маршрут уже пишеться."
      );
      invalidateShift();
      router.back();
    } finally {
      setBusy(false);
    }
  }, [value, readId, manual, isClosing, router, invalidateShift]);

  const title = isClosing ? "Одометр: кінець зміни" : "Одометр: початок зміни";
  const eyebrow = isClosing
    ? shift
      ? `Зміна з ${formatTime(shift.startedAt)}${shift.hoursOpen != null ? ` · ${String(shift.hoursOpen).replace(".", ",")} год` : ""}`
      : "Кінець зміни"
    : "Крок 1 з 1 · фото приладу";

  if (!permission) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.bk} />
      </View>
    );
  }

  const showCamera = !manual && permission.granted;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Header title={title} eyebrow={eyebrow} />

      <Screen>
        {showCamera && (
          <View style={s.camera}>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
            {/*
              Рамка й підказка — не декор. Найчастіша помилка зйомки не
              «розмито», а «сфотографовано TRIP замість ODO»: числа схожі,
              різниця в тому, що добовий менший і з комою. Рамка змушує
              прицілитися в потрібний лічильник ще до кадру.
            */}
            <View style={s.cameraOverlay} pointerEvents="none">
              <View style={s.guide} />
              <View style={s.hint}>
                <Text style={s.hintText}>Наведіть рамку на лічильник ODO, не TRIP</Text>
              </View>
            </View>
          </View>
        )}

        {!manual && !permission.granted && (
          <Card>
            <CardTitle>Потрібна камера</CardTitle>
            <Body>
              Фото одометра — підтвердження пробігу. Якщо камеру не дати, показання можна ввести
              руками, але офіс не зможе їх звірити.
            </Body>
            <Button tone="outline" small label="Дозволити камеру" onPress={requestPermission} />
          </Card>
        )}

        {showCamera && (
          <Button
            tone="brand"
            icon="camera"
            label={busy ? "Розпізнаю…" : "Зняти одометр"}
            onPress={capture}
            disabled={busy}
          />
        )}

        {/* Розпізнане число показуємо цифра до цифри: людина звіряє їх із
            приладом поглядом, а не перечитує шестизначне число цілком. */}
        {recognized?.ai.value != null && recognized.verdict.ok && (
          <AiResult data={recognized} />
        )}

        {!!note && (
          <Callout
            tone={recognized?.ai.value != null ? "warn" : "warn"}
            icon={recognized ? "triangle-alert" : "wifi-off"}
            title={recognized ? "Перевірте показання" : "Немає зв’язку"}
          >
            {note}
          </Callout>
        )}

        <Card>
          <CardTitle>Показання, км</CardTitle>
          <BigInput
            value={value}
            onChangeText={setValue}
            keyboardType="number-pad"
            placeholder="напр. 184320"
            unit="км"
          />
          <Note>Число завжди можна виправити — за приладом, а не за розпізнаванням.</Note>
        </Card>

        {/* Підсумок закриття: що саме поїде в розрахунок. Показуємо ДО
            натискання, поки число ще можна виправити — після закриття
            виправляє вже офіс. */}
        {isClosing && shift && <ClosingSummary shift={shift} typed={value} />}

        <Button
          tone="dark"
          icon={isClosing ? "flag" : "play"}
          label={busy ? "Зберігаю…" : isClosing ? "Закрити зміну" : "Відкрити зміну"}
          onPress={submit}
          disabled={busy}
        />

        {isClosing ? (
          <Note>
            Після закриття запис не зупиняється зовсім: навколо місця фінішу стане геозона 1 км, і
            дорога додому допишеться сама.
          </Note>
        ) : (
          <Note>
            Після відкриття запис маршруту стартує одразу, нагадування о 19:30 і 21:00 поставляться
            самі.
          </Note>
        )}

        {isClosing && (
          /*
            Раніше це посилання називалося «Закрити зміну і зупинити запис
            зовсім», хоча зміну воно не закривало — лише глушило трек. Людина
            тиснула його замість кнопки й лишалася з відкритою зміною, яку
            ввечері закривав сервер. Назва тепер каже рівно те, що робиться.
          */
          <TextLink
            label="Зупинити запис маршруту зовсім (зміну це не закриває)"
            onPress={() => stopEverything().then(() => router.back())}
          />
        )}

        {!manual && (
          <TextLink label="Ввести показання без фото" onPress={() => setManual(true)} />
        )}
      </Screen>
    </>
  );
}

/* ---------- Розпізнане число ---------- */

function AiResult({ data }: { data: OdometerRecognized }) {
  const digits = splitDigits(data.ai.digitsRead, data.ai.value);
  const low = data.verdict.warnings.includes("low_confidence");
  const tone = low ? "warn" : "good";
  const boxBg = low ? c.warnBg : c.surface;
  const boxLine = low ? c.warnLine : c.goodLine;
  const boxFg = low ? c.warnFg : c.text;

  return (
    <Callout
      tone={tone}
      icon="scan-line"
      title={
        low
          ? "Число розпізнане, але модель не впевнена — звірте з приладом."
          : "Перевірте число — воно розпізнане з фото."
      }
    >
      <View style={s.digits}>
        {digits.map((d, i) => (
          <View key={i} style={[s.digitBox, { backgroundColor: boxBg, borderColor: boxLine }]}>
            <Text style={[s.digitText, { color: boxFg }]}>{d}</Text>
          </View>
        ))}
      </View>
      <Note>{confidenceLine(data)}</Note>
    </Callout>
  );
}

/**
 * «1 8 4 3 2 0» → окремі цифри. Модель просять писати їх через пробіл саме
 * заради цього рядка; якщо не написала — розбираємо саме число.
 */
function splitDigits(digitsRead: string | null, value: number | null): string[] {
  const fromRead = (digitsRead ?? "").trim().split(/\s+/).filter((d) => /^\d$/.test(d));
  if (fromRead.length > 0) return fromRead;
  return value != null ? String(value).split("") : [];
}

/** «Впевненість 92 % · +118 км від минулої зміни — правдоподібно». */
function confidenceLine(data: OdometerRecognized): string {
  const parts: string[] = [];
  if (data.ai.confidence != null) {
    parts.push(`Впевненість ${Math.round(data.ai.confidence * 100)} %`);
  }
  if (data.verdict.deltaKm != null) {
    const km = data.verdict.deltaKm;
    parts.push(
      km === 0
        ? "той самий пробіг, що й минулого разу"
        : `${km > 0 ? "+" : ""}${km} км від попереднього показання`
    );
  }
  if (data.verdict.warnings.includes("few_digits")) parts.push("цифр замало — перевірте");
  if (data.verdict.warnings.includes("below_previous")) parts.push("менше за попереднє");
  // Друга думка від треку: не забороняє, лише просить глянути ще раз.
  if (data.verdict.warnings.includes("far_from_track")) parts.push("не сходиться з маршрутом");
  return parts.join(" · ");
}

/* ---------- Що вийде за зміну ---------- */

function ClosingSummary({
  shift,
  typed,
}: {
  shift: NonNullable<ShiftState["shift"]>;
  typed: string;
}) {
  const end = Number(typed.replace(/\D/g, ""));
  const start = shift.startOdometer;
  const km = Number.isInteger(end) && start != null && end >= start ? end - start : null;
  const gps = shift.gpsDistanceKm;
  const ratio = km != null && gps != null && gps > 0 ? km / gps : null;

  return (
    <Card>
      <CardTitle>Що вийде за зміну</CardTitle>
      <Row label="За одометром" value={km != null ? `${km} км` : "—"} />
      {/*
        Рядків про GPS немає, коли сервер не прислав числа, — а поки трек
        лагодять, він не присилає його нікому (src/lib/shift/track-visibility.ts).
        Показати тут «За GPS —» було б гірше за мовчання: порожнє місце в
        картці читається як поламане й породжує те саме питання, заради якого
        число й ховали.
      */}
      {gps != null && (
        <Row label="За GPS" value={`${String(gps).replace(".", ",")} км`} />
      )}
      {gps != null && ratio != null && (
        <Row
          label="Співвідношення"
          value={`${ratio.toFixed(2).replace(".", ",")} · ${
            ratio >= 0.9 && ratio <= 1.6 ? "у нормі" : "перевірте число"
          }`}
          tone={ratio >= 0.9 && ratio <= 1.6 ? "good" : "warn"}
        />
      )}
      <Row
        label="Триває"
        value={`з ${formatTime(shift.startedAt)}${
          shift.hoursOpen != null ? ` · ${String(shift.hoursOpen).replace(".", ",")} год` : ""
        }`}
      />
      {gps != null && (
        <Note>
          Одометр більший за GPS на кілька відсотків — так і має бути: трек це ламана між точками.
        </Note>
      )}
    </Card>
  );
}


const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  camera: {
    height: 260,
    borderRadius: r.card,
    overflow: "hidden",
    backgroundColor: "#141414",
  },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  guide: {
    width: 198,
    height: 80,
    borderRadius: r.sm,
    borderWidth: 2,
    borderColor: c.brand,
  },
  hint: {
    position: "absolute",
    bottom: 14,
    backgroundColor: "#00000099",
    borderRadius: r.chip,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  hintText: { color: c.onDark, fontSize: 11 },

  digits: { flexDirection: "row", gap: 4 },
  digitBox: {
    width: 30,
    height: 36,
    borderRadius: r.xs,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  digitText: { fontSize: 18, fontWeight: "700" },
});
