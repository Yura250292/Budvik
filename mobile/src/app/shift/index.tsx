/**
 * Зміна: відкрити, закрити, побачити стан треку.
 *
 * Екран навмисно вузький. Уся решта роботи торгового живе в кабінеті (сайт у
 * WebView), а тут — тільки те, чого сайт зробити не може: фонова геолокація,
 * дозволи системи й буфер точок, який лежить на самому пристрої.
 *
 * Верстка — з макета ~/Desktop/pencil-sales.pen (ряд «Зміна»). Порядок карток
 * у ньому не випадковий: спершу те, на що треба відповісти (звірка вчорашньої
 * зміни), потім стан, потім трек, і аж тоді дії. Людина відкриває цей екран
 * зранку в машині й гортає його великим пальцем — усе, що вимагає рішення,
 * мусить трапитися їй до першого прокручування.
 */

import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { staffApi, type ShiftState } from "@/api/staff";
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
import { readDeviceState, type DeviceState } from "@/track/device-state";
import { getLastFix, getLastHeartbeatAt, getMode, setShiftOpen, type TrackMode } from "@/track/state";
import { registerWatchdog } from "@/track/watchdog";
import { within, PROBE_MS } from "@/lib/within";
import { c, sp } from "@/ui/tokens";
import { SalesTabBar } from "@/ui/SalesTabBar";
import {
  Body,
  BigInput,
  Button,
  ButtonRow,
  Callout,
  Card,
  CardHead,
  Header,
  LinkList,
  LinkRow,
  Note,
  Pill,
  Row,
  Screen,
  StatTile,
  TileRow,
} from "@/ui/kit";

/** Пульс старший за це — мережі, найімовірніше, немає просто зараз. */
const PULSE_STALE_MS = 30 * 60_000;

export default function ShiftScreen() {
  const router = useRouter();
  const [state, setState] = useState<ShiftState | null>(null);
  const [pending, setPending] = useState<PendingShift | null>(null);
  const [perms, setPerms] = useState<PermissionState | null>(null);
  const [tracking, setTracking] = useState(false);
  const [mode, setMode] = useState<TrackMode | null>(null);
  const [buffered, setBuffered] = useState(0);
  const [lastFix, setLastFix] = useState<{ at: number; accuracyM: number | null } | null>(null);
  const [pulseAt, setPulseAt] = useState(0);
  /**
   * Мить останнього оновлення. Тримаємо в стані, а не питаємо годинник у
   * рендері: рендер мусить бути передбачуваним, а «скільки хвилин тому» і так
   * має сенс лише відносно моменту, коли дані прочитано.
   */
  const [now, setNow] = useState(0);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /**
   * Чим скінчився похід у налаштування батареї.
   *
   * Раніше кнопка просто відкривала екран і замовкала. На планшетах Lenovo
   * перемикач у загальному списку рухається, але нічого не змінює — людина
   * поверталася, бачила те саме попередження й вирішувала, що застосунок
   * зламаний. Тепер він сам питає систему й каже словами, спрацювало чи ні.
   */
  const [batteryResult, setBatteryResult] = useState<"ok" | "still" | null>(null);

  const refresh = useCallback(async () => {
    /**
     * Кожна проба з власною межею очікування, а не голий Promise.all.
     *
     * Досить одній з них кинути виняток або просто задуматися — а всі вони
     * ходять у системні служби (SQLite, батарея, дозволи) — і рендер лишався б
     * на вертушці назавжди: setLoading(false) стоїть після цього рядка. Людина
     * в машині бачила б порожній екран і не змогла б ані відкрити зміну, ані
     * закрити її.
     */
    const [p, t, m, b, q, dev, fix, pulse] = await Promise.all([
      within(currentPermissions(), PROBE_MS, null),
      within(isTracking(), PROBE_MS, false),
      within(getMode(), PROBE_MS, null),
      within(bufferedCount(), PROBE_MS, 0),
      within(getPendingShift(), PROBE_MS, null),
      within(readDeviceState(), PROBE_MS, null),
      within(getLastFix(), PROBE_MS, null),
      within(getLastHeartbeatAt(), PROBE_MS, 0),
    ]);
    setDevice(dev);
    setPerms(p);
    setTracking(t);
    setMode(m);
    setBuffered(b);
    setPending(q);
    setLastFix(fix);
    setPulseAt(pulse);
    setNow(Date.now());

    try {
      const s = await staffApi.shiftCurrent();
      setState(s);
      /**
       * Локальний прапорець потрібен фоновій службі, а не цьому екрану: вона
       * читає його в новому процесі, де пам'яті вже немає. Пишемо з межею
       * очікування — застрягла база не має тримати рендер маршруту.
       */
      await within(setShiftOpen(!!s.shift), PROBE_MS, undefined);
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

  const openBatterySettings = async () => {
    setBatteryResult(null);
    const optimized = await askIgnoreBatteryOptimizations();
    await refresh();
    if (optimized === null) return;
    setBatteryResult(optimized ? "still" : "ok");
  };

  const sendNow = async () => {
    setBusy(true);
    await flush().catch(() => {});
    await refresh();
    setBusy(false);
  };

  if (loading) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.bk} />
      </View>
    );
  }

  const shift = state?.shift ?? null;
  const shiftOpen = !!shift || pending?.action === "open";
  const pulseFresh = pulseAt > 0 && now - pulseAt < PULSE_STALE_MS;

  return (
    /*
      Нижнє меню тут таке саме, як у кабінеті. Без нього тап по «Зміні»
      відкривав нативний екран — і навігація зникала зовсім: назад вела лише
      стрілка в шапці. Виглядало це так, ніби застосунок кудись провалився.
    */
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <Header title="Зміна" eyebrow={formatToday()} />

      <Screen>
        {/*
          Звірка вчорашньої зміни — над усім іншим.
          Зміну закрив сервер або офіс, і поки людина не сказала «так
          було», кілометри в ній стоять на здогадці треку. Показуємо це
          першим, бо саме ранкове фото одометра щойно дало число: якщо
          картка буде третьою, її прогорнуть і не побачать.
        */}
        {state?.needsConfirmation && <ConfirmCard data={state.needsConfirmation} onDone={refresh} />}

        {/* Відкладений запит видно окремо: людина мусить розуміти, що кнопку
            натиснуто, просто мережа ще не з'явилася. */}
        {pending && (
          <Card tone="brand" gap={sp.xs}>
            <CardHead
              title={pending.action === "open" ? "Відкриття чекає мережі" : "Закриття чекає мережі"}
              icon="cloud-off"
            />
            <Body>
              Одометр {pending.odometer} км збережено на пристрої. Надішлемо самі, щойно з’явиться
              зв’язок — тикати кнопку ще раз не треба.
            </Body>
          </Card>
        )}

        <Card gap={10}>
          <CardHead
            title={shiftOpen ? "Зміна відкрита" : "Зміна закрита"}
            dot={shiftOpen ? c.good : "#C9C9C6"}
            right={
              shift ? <Text style={s.since}>з {formatTime(shift.startedAt)}</Text> : undefined
            }
          />

          {shift && (
            <>
              {/*
                «Точок» рахує сервер, а не буфер на пристрої: буфер знає лише
                НЕнадіслані точки, і на добре працюючому планшеті показував би
                нуль. А питання тут рівно протилежне — чи трек взагалі живий.
                Нуль о другій годині дня означає, що день ще можна врятувати.
              */}
              <TileRow>
                <StatTile
                  label="За GPS"
                  value={shift.gpsDistanceKm != null ? formatNumber(shift.gpsDistanceKm) : "—"}
                  unit="км"
                />
                <StatTile
                  label="Триває"
                  value={shift.hoursOpen != null ? formatNumber(shift.hoursOpen) : "—"}
                  unit="год"
                />
                <StatTile
                  label="Точок"
                  value={shift.pointsCount != null ? formatKm(shift.pointsCount) : "—"}
                  tone={shift.pointsCount === 0 ? "bad" : undefined}
                />
              </TileRow>
              <Row
                label="Одометр на старті"
                value={shift.startOdometer != null ? `${formatKm(shift.startOdometer)} км` : "—"}
              />
              <Row label="Початок" value={formatTime(shift.startedAt)} />
            </>
          )}

          {!shift && state?.previous?.endOdometer != null && (
            <Row
              label="Одометр минулої зміни"
              value={`${formatKm(state.previous.endOdometer)} км`}
            />
          )}
          {!shift && state?.previous?.endedAt && (
            <Row
              label="Минула зміна"
              value={`${formatDay(state.previous.endedAt)} · до ${formatTime(state.previous.endedAt)}${
                state.previous.distanceKm != null ? ` · ${state.previous.distanceKm} км` : ""
              }`}
            />
          )}

          {shift?.shouldRemindToClose && (
            <Note tone="bad">
              Зміна триває надто довго. Якщо ви вже вдома — закрийте її, поки її не визнали забутою.
            </Note>
          )}
        </Card>

        <Card>
          <CardHead title="Маршрут" right={<TrackPill tracking={tracking} mode={mode} />} />

          {lastFix && (
            <Row
              label="Остання точка"
              value={`${formatAgo(lastFix.at, now)}${
                lastFix.accuracyM != null ? ` · ±${Math.round(lastFix.accuracyM)} м` : ""
              }`}
              tone={now - lastFix.at > 15 * 60_000 ? "warn" : undefined}
            />
          )}
          <Row
            label="Не надіслано точок"
            value={String(buffered)}
            tone={buffered > 0 ? "warn" : undefined}
          />
          <Row
            label="Мережа"
            value={
              pulseAt === 0
                ? "пульсу ще не було"
                : pulseFresh
                  ? `є, пульс ${formatTime(new Date(pulseAt).toISOString())}`
                  : `немає з ${formatTime(new Date(pulseAt).toISOString())}`
            }
            tone={pulseAt > 0 && !pulseFresh ? "bad" : undefined}
          />

          {buffered > 0 && (
            <Button
              tone="outline"
              icon="upload"
              label={busy ? "Надсилаю…" : "Надіслати зараз"}
              onPress={sendNow}
              disabled={busy}
              small
            />
          )}

          {/*
            Найчастіша причина дір у маршруті, і людина про неї не здогадається
            сама: система присипляє застосунок заради батареї, трек рветься на
            години й «сам відновлюється». Тому це не підказка дрібним шрифтом, а
            помітне попередження з кнопкою, що веде прямо в потрібні налаштування.
          */}
          {device?.batteryOptimized === true && (
            <Callout
              tone="bad"
              icon="triangle-alert"
              title="Система присипляє застосунок"
              action={{ label: "Відкрити налаштування батареї", onPress: openBatterySettings }}
            >
              {/* Шлях названо покроково: у загальному списку оптимізації на
                  планшетах Lenovo перемикач рухається, але нічого не змінює. */}
              <Body>
                Через це маршрут рветься на години, а пробіг виходить меншим за справжній. На екрані,
                що відкриється, знайдіть «Батарея» і оберіть «Без обмежень».
              </Body>
            </Callout>
          )}

          {/* Відповідь на «я натиснув, і нічого не сталося»: тепер сталося або
              не сталося, і це написано. */}
          {batteryResult === "ok" && (
            <Note tone="warn">Готово: система більше не присипляє застосунок.</Note>
          )}
          {batteryResult === "still" && (
            <Note tone="bad">
              Обмеження ще діє. На екрані застосунку відкрийте «Батарея» і оберіть саме «Без
              обмежень» — перемикач у загальному списку оптимізації на цьому планшеті нічого не
              змінює.
            </Note>
          )}

          {device?.locationMode === "OFF" && (
            <Callout tone="bad" icon="triangle-alert" title="Геолокацію вимкнено">
              Маршрут не пишеться взагалі. Увімкніть визначення місця в шторці налаштувань телефона.
            </Callout>
          )}

          {perms && !perms.background && (
            <Note tone="warn">
              Дозвіл «Завжди» не виданий — запис зупиниться, коли екран згасне.
            </Note>
          )}
        </Card>

        {shiftOpen ? (
          <Button
            tone="dark"
            icon="camera"
            label="Закрити зміну"
            onPress={() => router.push("/shift/odometer?phase=END")}
          />
        ) : (
          <Button tone="brand" icon="camera" label="Відкрити зміну" onPress={open} />
        )}

        <LinkList>
          {/* Вихід на пізнє закриття показуємо лише коли він потрібен: зміна
              відкрита довше за робочий день. Кнопка «забув закрити» на очах у
              того, хто нічого не забув, лише плутає. */}
          {shift?.shouldRemindToClose && (
            <LinkRow
              icon="clock-alert"
              tone="warn"
              label="Забув закрити — порахувати за треком"
              onPress={() => router.push("/shift/late-close")}
            />
          )}
          <LinkRow icon="history" label="Історія змін" onPress={() => router.push("/shift/history")} />
          {/* Сторож реєструється тут, а не при запуску: він потрібен лише тому,
              хто справді користується змінами, і питати систему про фонові
              завдання у покупця немає підстав. */}
          <LinkRow
            icon="shield-check"
            label="Перевірити фонову службу"
            onPress={async () => {
              await registerWatchdog();
              await refresh();
            }}
          />
          <LinkRow
            icon="battery-charging"
            label="Не обмежувати батарею для застосунку"
            onPress={openBatterySettings}
          />
          {tracking && !shiftOpen && (
            <LinkRow
              icon="square"
              tone="bad"
              label="Зупинити запис маршруту"
              onPress={() => stopEverything().then(refresh)}
            />
          )}
          {!tracking && shiftOpen && (
            <LinkRow
              icon="play"
              label="Увімкнути запис маршруту"
              onPress={() => startTracking("SHIFT").then(refresh)}
            />
          )}
        </LinkList>
      </Screen>

      <SalesTabBar />
    </View>
  );
}

/** Стан запису одним словом: він відповідає на «а чи пишеться взагалі?». */
function TrackPill({ tracking, mode }: { tracking: boolean; mode: TrackMode | null }) {
  if (!tracking) return <Pill tone="bad" label="запис не йде" />;
  if (mode === "AFTER_SHIFT") return <Pill tone="info" label="дорога додому · геозона 1 км" />;
  return <Pill tone="good" label="запис іде" />;
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
  const source = SOURCE_LABEL[data.lateCloseSource ?? ""] ?? null;

  return (
    <Card tone="brand" gap={sp.sm}>
      <CardHead
        icon="badge-alert"
        iconColor="#B48F00"
        title={auto ? `Зміну закрито автоматично о ${when}` : `Зміна закрита о ${when}`}
      />

      <Body>
        {data.lateCloseSource === "AUTO_DEAD"
          ? "Маршрут перестав писатися, тому час узято з останньої точки. Перевірте його."
          : data.lateCloseSource === "AUTO_FORCED"
            ? "Машина ще рухалась, але зміна тривала надто довго — час закриття приблизний."
            : data.lateCloseSource === "AUTO_GAP"
              ? "Маршрут писався з розривом: планшет замовк і озвався вже на місці. Робота могла скінчитися РАНІШЕ за цей час — якщо так, виправте його в офісі."
              : "Час узято з треку: після нього машина стала й більше не рушила."}
      </Body>

      {/* Звідки взявся час — окремою міткою: від цього залежить, чи взагалі
          варто його виправляти в офісі. */}
      {!!source && (
        <View style={s.sourceBadge}>
          <Text style={s.sourceLabel}>{source}</Text>
        </View>
      )}

      {data.distanceKm != null && (
        <Row label="Пробіг за одометром" value={`${formatNumber(data.distanceKm)} км`} />
      )}
      {data.gpsDistanceKm != null && (
        <Row label="За GPS" value={`${formatNumber(data.gpsDistanceKm)} км`} />
      )}
      {data.afterWorkKm != null && data.afterWorkKm > 0 && (
        <Row
          label="Дорога додому (відняті)"
          value={`${formatNumber(data.afterWorkKm)} км`}
          tone="muted"
        />
      )}
      {data.endOdometer == null && (
        <Note>
          Одометр на кінець роботи ще невідомий — він порахується з фото наступної зміни.
        </Note>
      )}

      {editing ? (
        <>
          <BigInput
            value={value}
            onChangeText={setValue}
            keyboardType="number-pad"
            placeholder={`більше за ${data.startOdometer}`}
            unit="км"
          />
          <Button
            tone="brand"
            icon="check"
            label={busy ? "Зберігаю…" : "Зберегти одометр"}
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
          />
          <Button tone="outline" small label="Скасувати" onPress={() => setEditing(false)} />
        </>
      ) : (
        <>
          <Button
            tone="brand"
            icon="check"
            label={busy ? "Надсилаю…" : "Все вірно"}
            disabled={busy}
            onPress={() => void run(() => staffApi.shiftConfirm(data.shiftId, { ok: true }), "Не прийнято")}
          />
          <ButtonRow>
            <Button
              tone="outline"
              icon="pencil"
              small
              label="Вказати одометр"
              onPress={() => setEditing(true)}
              style={{ flex: 1 }}
            />
            {/* Повернення в роботу — лише поки сервер його приймає: це
                виправлення свіжої помилки, а не спосіб переписати день. */}
            {data.canReopen && (
              <Button
                tone="outline"
                icon="rotate-ccw"
                small
                label="Я ще працював"
                disabled={busy}
                onPress={() => void run(() => staffApi.shiftReopen(data.shiftId), "Не вдалося відновити")}
                style={{ flex: 1 }}
              />
            )}
          </ButtonRow>
          {data.canReopen && (
            <Note>Відновити зміну можна лише кілька годин після закриття — далі це робить офіс.</Note>
          )}
        </>
      )}
    </Card>
  );
}

/** Код джерела часу людською мовою — щоб мітка пояснювала, а не шифрувала. */
const SOURCE_LABEL: Record<string, string> = {
  AUTO_GAP: "AUTO_GAP · час — верхня межа",
  AUTO_DEAD: "AUTO_DEAD · час з останньої точки",
  AUTO_FORCED: "AUTO_FORCED · час приблизний",
  AUTO_GPS: "AUTO_GPS · час за зупинкою в треку",
  GPS: "GPS · час за зупинкою в треку",
  OFFICE: "OFFICE · закрив офіс",
};

/** «ЧЕТВЕР, 28 СЕРПНЯ» — надзаголовок шапки. */
function formatToday(): string {
  try {
    return new Date().toLocaleDateString("uk-UA", {
      timeZone: "Europe/Kyiv",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return "Зміна";
  }
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

function formatDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("uk-UA", {
      timeZone: "Europe/Kyiv",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** «2 хв тому» — час у хвилинах читається швидше за годинник. */
function formatAgo(at: number, now: number): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "щойно";
  if (min < 60) return `${min} хв тому`;
  const h = Math.floor(min / 60);
  return `${h} год ${min % 60} хв тому`;
}

/** Дробові — з комою, як усюди в українському інтерфейсі. */
function formatNumber(n: number): string {
  return String(n).replace(".", ",");
}

/** 184 320 — нерозривні пробіли, щоб число не рвалося на два рядки. */
function formatKm(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  since: { fontSize: 13, color: c.text3 },
  sourceBadge: {
    alignSelf: "flex-start",
    backgroundColor: c.warnBg,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  sourceLabel: { fontSize: 11, fontWeight: "600", color: c.warnFg },
});
