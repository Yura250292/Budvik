/**
 * День водія: точки маршруту, відмітки, каса.
 *
 * Перший екран кабінету, переписаний нативно, і саме цей — не за красу. У
 * WebView відмітка без зв'язку просто падала: водій стояв біля магазину,
 * тикав «Виконано», бачив помилку і їхав далі — точка лишалася невідміченою,
 * а ввечері день не сходився ні за адресами, ні за грошима. Тут відмітка
 * лягає в чергу на пристрої й показується виконаною одразу.
 *
 * Карти немає навмисно — рішення власника від 25.08: дорогу водій дивиться в
 * Google Maps, а сюди ходить відмічатися. Посилання будуються від поточної
 * позиції через ще НЕ відмічені точки: везти людину туди, де вона вже була,
 * немає сенсу.
 *
 * Верстка з макета (~/Desktop/pencil-sales.pen, ряд «водій»). Головне рішення
 * там — точки не картками, а суцільним списком на всю ширину: водій гортає їх
 * весь день однією рукою, і поля між картками з'їдали б третину екрана. Стан
 * точки видно кольором смуги ще до того, як прочитано назву.
 */

import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Linking,
  RefreshControl,
} from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import * as Updates from "expo-updates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { staffApi, type DayResponse, type DayStop } from "@/api/staff";
import { formatUAH } from "@/theme";
import { c, r, sp } from "@/ui/tokens";
import { Icon } from "@/ui/Icon";
import {
  Body,
  Button,
  ButtonRow,
  Callout,
  Card,
  CardTitle,
  Eyebrow,
  Field,
  GoldLine,
  Note,
  Screen,
} from "@/ui/kit";
import { DriverTabBar } from "@/ui/DriverTabBar";
import { bufferedCount } from "@/track/db";
import { isTracking } from "@/track/controller";
import {
  flushPendingVisits,
  listPendingVisits,
  queueVisit,
  type PendingVisit,
} from "@/track/pending-visits";
import { googleMapsLinks, pointUrl } from "@/lib/google-links";
import { within, PROBE_MS } from "@/lib/within";

type Money = "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";

/** Стільки НЕнадісланих точок уже означає не паузу між пачками, а тишу мережі. */
const OFFLINE_POINTS = 20;

/** Скільки чекаємо на віддачу черги, перш ніж малювати день без неї. */
const FLUSH_MS = 8_000;

export default function DayScreen() {
  const [data, setData] = useState<DayResponse | null>(null);
  const [queued, setQueued] = useState<PendingVisit[]>([]);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [buffered, setBuffered] = useState(0);

  const load = useCallback(async () => {
    /**
     * Спершу віддати те, що лежить у черзі: інакше сервер поверне день без
     * відміток, які водій уже зробив, і вони «зникнуть» з екрана.
     *
     * З межею очікування: у fetch немає власного тайм-ауту, і в мертвій мережі
     * (є Wi-Fi заправки, але інтернету за ним немає) запит висить хвилинами.
     * Без межі екран дня не з'явився б узагалі — а він потрібен саме там, де
     * зв'язку немає. Невіддана черга від цього не губиться: точки з неї далі
     * показані виконаними, і наступне відкриття спробує ще раз.
     */
    await within(flushPendingVisits(), FLUSH_MS, 0);
    // Кожна проба з межею очікування: збій чи затримка SQLite або служби
    // локації не має лишати водія на вертушці — день читається з мережі й від
    // них не залежить.
    setQueued(await within(listPendingVisits(), PROBE_MS, [] as PendingVisit[]));
    setTracking(await within(isTracking(), PROBE_MS, false));
    setBuffered(await within(bufferedCount(), PROBE_MS, 0));
    try {
      setData(await staffApi.day());
      setError(null);
    } catch (e) {
      // Немає зв'язку — не помилка, а звичайний стан на маршруті.
      setError(e instanceof Error ? e.message : "Немає зв’язку");
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      Location.getLastKnownPositionAsync()
        .then((p) => p && setPos({ lat: p.coords.latitude, lng: p.coords.longitude }))
        .catch(() => {});
    }, [load])
  );

  const stops = useMemo(() => data?.route?.stops ?? [], [data?.route?.stops]);
  const queuedKeys = useMemo(() => new Set(queued.map((q) => q.stopKey)), [queued]);

  /** Відмічена — це або відмітка з сервера, або та, що чекає в черзі. */
  const isMarked = useCallback(
    (s: DayStop) => !!s.visit || queuedKeys.has(s.key),
    [queuedKeys]
  );

  const mapLinks = useMemo(() => {
    const pending = stops
      .filter((s) => !isMarked(s) && s.lat != null && s.lng != null)
      .map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
    if (pending.length === 0) return [];
    return googleMapsLinks(pos ? [pos, ...pending] : pending);
  }, [stops, pos, isMarked]);

  const mark = useCallback(
    async (
      stop: DayStop,
      status: "DONE" | "MISSED",
      money: Money,
      extra?: { collectedAmount?: number; comment?: string }
    ) => {
      const isErrand = stop.kind !== "DELIVERY";
      if (!isErrand && !stop.counterpartyId) return;

      const entry: PendingVisit = isErrand
        ? {
            stopKey: stop.key,
            kind: "errand",
            errandStopId: stop.key.slice(3),
            errandStatus: status === "DONE" ? "DELIVERED" : "FAILED",
            comment: extra?.comment,
            createdAt: Date.now(),
          }
        : {
            stopKey: stop.key,
            kind: "visit",
            visit: {
              counterpartyId: stop.counterpartyId as string,
              status,
              money,
              debtAmount: stop.debtAmount,
              collectedAmount: extra?.collectedAmount ?? null,
              comment: extra?.comment ?? null,
              routeSheetStopId: stop.key.startsWith("rs:") ? stop.key.slice(3) : null,
              deliveryStopId: stop.key.startsWith("ds:") ? stop.key.slice(3) : null,
              // Де стояв планшет у мить відмітки — доказ присутності.
              lat: pos?.lat ?? null,
              lng: pos?.lng ?? null,
            },
            createdAt: Date.now(),
          };

      /**
       * Спершу в чергу, потім спроба надіслати.
       *
       * Такий порядок означає, що відмітка не губиться навіть тоді, коли
       * застосунок закриють одразу після натискання.
       */
      await queueVisit(entry);
      setQueued(await listPendingVisits());
      setOpenKey(null);
      await load();
    },
    [pos, load]
  );

  if (loading) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.bk} />
      </View>
    );
  }

  const p = data?.progress;
  const cash = data?.cash;
  const offline = buffered >= OFFLINE_POINTS;

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <DayHeader
        route={data?.route?.number ?? null}
        progress={p}
        km={data?.track.distanceKm ?? 0}
        tracking={tracking}
        buffered={buffered}
        offline={offline}
      />

      <UpdateBar />

      <Screen
        padded={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {queued.length > 0 && (
          <View style={s.section}>
            <Card tone="brand" style={s.queueCard} gap={sp.xxs}>
              <View style={s.queueRow}>
                <Icon name="cloud-off" size={22} color={c.warn} />
                <View style={s.queueText}>
                  <CardTitle>Чекає на мережу: {queued.length}</CardTitle>
                  <Note>
                    Відмітки збережено на пристрої й показано як виконані. Надішлемо самі — тикати
                    ще раз не треба.
                    {buffered > 0 ? ` Трек теж у буфері: ${buffered} точок.` : ""}
                  </Note>
                </View>
              </View>
            </Card>
          </View>
        )}

        {error && !data && (
          <View style={s.section}>
            <Card tone="warn">
              <CardTitle>Немає зв’язку</CardTitle>
              <Body>
                День не завантажився. Маршрут і трек від цього не залежать — запис іде далі.
              </Body>
            </Card>
          </View>
        )}

        {mapLinks.length > 0 && (
          <View style={s.block}>
            <Eyebrow>Дорога в Google Maps</Eyebrow>
            <View style={s.mapLinks}>
              {mapLinks.map((l, i) => (
                <Pressable
                  key={i}
                  style={[s.mapLink, i === 0 ? s.mapLinkPrimary : s.mapLinkSecondary]}
                  onPress={() => Linking.openURL(l.url)}
                >
                  <Icon name="navigation" size={16} color={i === 0 ? c.onDark : c.infoFg} />
                  <Text style={[s.mapLinkLabel, { color: i === 0 ? c.onDark : c.infoFg }]}>
                    {mapLinks.length > 1 ? `Частина ${i + 1} · ${l.points} точок` : "Прокласти дорогу"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Note>
              Google веде щонайбільше 10 точок за раз. Доїхали до кінця першої частини —
              відкривайте наступну, вона починається там само. Відмічені точки в дорогу не входять.
            </Note>
          </View>
        )}

        {stops.length > 0 && (
          <View style={s.stops}>
            {stops.map((st) => (
              <StopRow
                key={st.key}
                stop={st}
                queued={queuedKeys.has(st.key)}
                expanded={openKey === st.key}
                onToggle={() => setOpenKey(openKey === st.key ? null : st.key)}
                onMark={mark}
              />
            ))}
          </View>
        )}

        {stops.length === 0 && !error && (
          <View style={s.section}>
            <Card>
              <CardTitle>На сьогодні точок немає</CardTitle>
              <Body>
                Маршрут складає логіст в адмінці. Якщо ви вже в дорозі — зателефонуйте в офіс.
              </Body>
            </Card>
          </View>
        )}

        {cash && <CashSection cash={cash} day={data?.day} onDone={load} />}
      </Screen>

      <DriverTabBar active="today" />
    </View>
  );
}

/* ---------- Шапка дня ---------- */

/**
 * Чорна шапка з трьома числами: скільки точок пройдено, скільки грошей зібрано
 * і чи пишеться трек.
 *
 * Стан треку саме тут, а не на екрані зміни: водій відкриває «Мій день»
 * десятки разів на добу й жодного разу — «Зміну». Мовчазний трек інакше
 * помічають аж наступного дня, коли пробіг уже не відновити.
 */
function DayHeader({
  route,
  progress,
  km,
  tracking,
  buffered,
  offline,
}: {
  route: string | null;
  progress: DayResponse["progress"] | undefined;
  km: number;
  tracking: boolean;
  buffered: number;
  offline: boolean;
}) {
  const insets = useSafeAreaInsets();
  const done = progress?.done ?? 0;
  const missed = progress?.missed ?? 0;
  const total = progress?.total ?? 0;

  const dot = !tracking ? c.bad : offline ? c.warn : c.good;
  const status = !tracking ? "Трек не йде" : offline ? "Немає звʼязку" : "Трек іде";

  return (
    <View style={s.header}>
      <GoldLine />
      <View style={{ height: insets.top }} />
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {route ? `Маршрут ${route}` : "Маршрут не складено"}
          </Text>
          {!!progress && (
            <View style={s.headerProgress}>
              <Text style={s.headerMuted}>
                {done + missed} з {total} точок ·{" "}
              </Text>
              <Text style={s.headerMoney}>{formatUAH(progress.collected)}</Text>
              <Text style={s.headerMuted}> / {formatUAH(progress.debtPlanned)}</Text>
            </View>
          )}
        </View>
        <View style={s.headerRight}>
          <View style={s.headerKm}>
            <Text style={s.headerKmValue}>{String(km).replace(".", ",")}</Text>
            <Text style={s.headerMuted}>км</Text>
          </View>
          <View style={s.headerStatus}>
            <View style={[s.statusDot, { backgroundColor: dot }]} />
            <Text style={s.headerStatusLabel}>{status}</Text>
            {buffered > 0 && <Text style={s.headerBuffer}>+{buffered} точок</Text>}
          </View>
        </View>
      </View>

      {/* Смуга під шапкою: зелене — зроблено, червоне — не потрапив. */}
      <View style={s.bar}>
        {total > 0 && <View style={[s.barDone, { flex: done }]} />}
        {total > 0 && <View style={[s.barMissed, { flex: missed }]} />}
        <View style={{ flex: Math.max(0, total - done - missed) || (total ? 0 : 1) }} />
      </View>
    </View>
  );
}

/**
 * Смуга «вийшло оновлення».
 *
 * Оновлення JS приїжджає саме, але застосовується лише на холодному старті, а
 * планшет у машині не вимикають тижнями. Тому пропонуємо перезапуск явно —
 * і лише тоді, коли оновлення справді вже завантажене.
 */
function UpdateBar() {
  const { isUpdatePending } = Updates.useUpdates();
  if (!isUpdatePending) return null;
  return (
    <Pressable style={s.updateBar} onPress={() => Updates.reloadAsync().catch(() => {})}>
      <Icon name="refresh-cw" size={16} color={c.bk} />
      <Text style={s.updateLabel}>Вийшло оновлення — натисніть, щоб перезавантажити</Text>
    </Pressable>
  );
}

/* ---------- Точка маршруту ---------- */

function StopRow({
  stop,
  queued,
  expanded,
  onToggle,
  onMark,
}: {
  stop: DayStop;
  queued: boolean;
  expanded: boolean;
  onToggle: () => void;
  onMark: (
    s: DayStop,
    status: "DONE" | "MISSED",
    money: Money,
    extra?: { collectedAmount?: number; comment?: string }
  ) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const isErrand = stop.kind !== "DELIVERY";
  const missed = stop.visit?.status === "MISSED";
  const marked = !!stop.visit || queued;

  const tint = queued
    ? c.warnBg
    : missed
      ? c.badBg
      : stop.visit
        ? c.goodBg
        : isErrand
          ? "#FFFDF5"
          : c.surface;

  return (
    <View style={[s.stop, { backgroundColor: tint }]}>
      <Pressable style={s.stopHead} onPress={onToggle}>
        <View
          style={[
            s.badge,
            {
              backgroundColor: queued ? c.warn : missed ? c.bad : stop.visit ? c.good : "#E5E7EB",
            },
          ]}
        >
          {queued ? (
            <Icon name="hourglass" size={16} color={c.onDark} />
          ) : missed ? (
            <Icon name="x" size={18} color={c.onDark} />
          ) : stop.visit ? (
            <Icon name="check" size={18} color={c.onDark} />
          ) : (
            <Text style={s.badgeNum}>{stop.sequence}</Text>
          )}
        </View>

        <View style={s.stopBody}>
          <View style={s.stopNameRow}>
            {isErrand && (
              <View style={s.kind}>
                <Text style={s.kindLabel}>{stop.kind === "PICKUP" ? "ЗАБРАТИ" : "СПРАВА"}</Text>
              </View>
            )}
            <Text style={s.stopName}>{stop.name}</Text>
          </View>
          {!!stop.address && <Text style={s.stopAddress}>{stop.address}</Text>}
          {!!stop.notes && <Text style={s.stopNote}>Логіст: {stop.notes}</Text>}

          <View style={s.stopMeta}>
            {stop.amount > 0 && <Text style={s.metaPlain}>{formatUAH(stop.amount)}</Text>}
            {stop.debtAmount > 0 && (
              <Text style={s.metaBad}>борг {formatUAH(stop.debtAmount)}</Text>
            )}
            {stop.visit?.collectedAmount != null && stop.visit.collectedAmount > 0 && (
              <Text style={s.metaGood}>забрано {formatUAH(stop.visit.collectedAmount)}</Text>
            )}
            {queued && (
              <Text style={s.metaWarn}>
                збережено на пристрої{stop.visit?.status === "MISSED" ? " · не застав" : ""}
              </Text>
            )}
            {!queued && missed && <Text style={s.metaBad}>не застав</Text>}
          </View>
        </View>

        {!marked && (
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} color={c.text3} />
        )}
      </Pressable>

      {expanded && !marked && (
        <View style={s.panel}>
          {/*
            Точка без клієнта — недороблений маршрут, а не збій планшета.
            Мовчазна кнопка змушувала б тикати її знову й знову.
          */}
          {!isErrand && !stop.counterpartyId ? (
            <Callout tone="warn" icon="triangle-alert" title="Точку не прив’язано до клієнта">
              Відмітити її звідси не вийде — логіст не вказав контрагента. Зателефонуйте в офіс,
              там це виправляють за хвилину.
            </Callout>
          ) : isErrand ? (
            <>
              {/* Бонусна поїздка: без товару й без інкасації — лише факт. */}
              <ButtonRow>
                <Button
                  tone="good"
                  label="Виконано"
                  style={s.flex}
                  onPress={() => onMark(stop, "DONE", "NOT_APPLICABLE", { comment })}
                />
                <Button
                  tone="bad"
                  label="Не вийшло"
                  style={s.flex}
                  onPress={() => onMark(stop, "MISSED", "NOT_APPLICABLE", { comment })}
                />
              </ButtonRow>
              <Field value={comment} onChangeText={setComment} placeholder="Коментар (необов’язково)" />
            </>
          ) : (
            <>
              <ButtonRow>
                <Button
                  tone="good"
                  label={
                    stop.debtAmount > 0 ? `Приїхав, забрав ${formatUAH(stop.debtAmount)}` : "Приїхав"
                  }
                  style={s.flex}
                  onPress={() =>
                    onMark(stop, "DONE", stop.debtAmount > 0 ? "FULL" : "NONE", { comment })
                  }
                />
                <Button
                  tone="bad"
                  label="Не потрапив"
                  style={s.flex}
                  onPress={() => onMark(stop, "MISSED", "NOT_APPLICABLE", { comment })}
                />
              </ButtonRow>

              {/* Часткова сума окремим рядком: вона потрібна рідше, ніж
                  «забрав усе», але саме через неї день не сходиться. */}
              <View style={s.moneyRow}>
                <Button
                  tone="outline"
                  small
                  label="Не забрав нічого"
                  style={s.flex}
                  onPress={() => onMark(stop, "DONE", "NONE", { comment })}
                />
                <Field
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder="Сума"
                  style={s.amount}
                />
                <Pressable
                  style={[s.ok, !amount && s.okOff]}
                  disabled={!amount}
                  onPress={() =>
                    onMark(stop, "DONE", "PARTIAL", {
                      collectedAmount: Number(amount.replace(",", ".")),
                      comment,
                    })
                  }
                >
                  <Text style={[s.okLabel, !amount && s.okLabelOff]}>ОК</Text>
                </Pressable>
              </View>

              <Field
                value={comment}
                onChangeText={setComment}
                placeholder="Коментар: магазин закритий, немає грошей…"
              />
            </>
          )}

          {stop.lat != null && stop.lng != null && (
            <Button
              tone="info"
              small
              icon="navigation"
              label="Відкрити в Google Maps"
              onPress={() =>
                Linking.openURL(pointUrl({ lat: stop.lat as number, lng: stop.lng as number }))
              }
            />
          )}
        </View>
      )}
    </View>
  );
}

/* ---------- Каса ---------- */

function CashSection({
  cash,
  day,
  onDone,
}: {
  cash: NonNullable<DayResponse["cash"]>;
  day?: string;
  onDone: () => Promise<void>;
}) {
  // Сума наперед заповнена тим, що водій везе: зазвичай він просто підтверджує.
  const [amount, setAmount] = useState(cash.onHands > 0 ? String(cash.onHands) : "");
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setErr("Вкажіть суму, яку здаєте");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await staffApi.cashHandover({ amount: value, day, comment: comment || undefined });
      setOpen(false);
      setComment("");
      await onDone();
    } catch (e) {
      /**
       * Інкасацію в чергу НЕ кладемо: це гроші, і «здав» без підтвердження
       * офісу — небезпечна ілюзія. Краще чесно сказати, що не пройшло.
       */
      setErr(e instanceof Error ? e.message : "Не вдалося. Спробуйте, коли буде зв’язок");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.block}>
      <Eyebrow>Каса за сьогодні</Eyebrow>

      <View style={s.cashLine}>
        <Text style={s.cashCollected}>Зібрано {formatUAH(cash.collected)}</Text>
        {cash.handed > 0 && <Text style={s.cashHanded}>здано {formatUAH(cash.handed)}</Text>}
      </View>

      {/* «На руках» — головне число дня: саме за нього водій відповідає
          власною кишенею, тому воно й найбільше на екрані. */}
      <View style={s.cashHero}>
        <Text style={s.cashHeroLabel}>На руках:</Text>
        <Text style={s.cashHeroValue}>{formatUAH(cash.onHands)}</Text>
      </View>

      {cash.handovers.map((h) => (
        <View key={h.id} style={s.handover}>
          <View>
            <View style={s.handoverTop}>
              <Text style={s.handoverAmount}>{formatUAH(h.amount)}</Text>
              {!!h.confirmedAt && <Text style={s.handoverTime}>о {formatTime(h.confirmedAt)}</Text>}
            </View>
            <Text style={h.confirmedAt ? s.handoverOk : s.handoverWait}>
              {h.confirmedAt
                ? `Прийнято ${formatUAH(h.confirmedAmount ?? h.amount)}`
                : "Чекає підтвердження офісу"}
            </Text>
          </View>
        </View>
      ))}

      {!!err && <Note tone="bad">{err}</Note>}

      {cash.onHands > 0 &&
        (open ? (
          <View style={s.handoverForm}>
            <Text style={s.formLabel}>Скільки здаєте, ₴</Text>
            <View style={s.amountBox}>
              <Field
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                style={s.amountBig}
              />
            </View>
            <Note>
              Підставлено суму на руках — зазвичай її досить підтвердити. Офіс перевірить і прийме.
            </Note>
            <Field value={comment} onChangeText={setComment} placeholder="Коментар: решта, розмін…" />
            <ButtonRow>
              <Button tone="outline" small label="Скасувати" onPress={() => setOpen(false)} />
              <Button
                tone="good"
                icon="check"
                label={busy ? "Здаю…" : "Підтверджую здачу"}
                disabled={busy}
                style={s.flex}
                onPress={submit}
              />
            </ButtonRow>
            <Note>
              Здача не стає в чергу офлайн: «здав» без підтвердження офісу — небезпечна ілюзія.
            </Note>
          </View>
        ) : (
          <Button
            tone="dark"
            icon="banknote"
            label={`Здаю касу ${formatUAH(cash.onHands)}`}
            onPress={() => setOpen(true)}
          />
        ))}
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  flex: { flex: 1 },

  header: { backgroundColor: c.bk },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: sp.gap,
    paddingTop: 6,
    paddingHorizontal: sp.pad,
    paddingBottom: sp.gap,
  },
  headerLeft: { flex: 1, gap: 3 },
  headerTitle: { color: c.onDark, fontSize: 16, fontWeight: "700" },
  headerProgress: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  headerMuted: { color: c.onDarkMuted, fontSize: 12 },
  headerMoney: { color: "#4ADE80", fontSize: 12, fontWeight: "600" },
  headerRight: { alignItems: "flex-end", gap: 3 },
  headerKm: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  headerKmValue: { color: c.onDark, fontSize: 18, fontWeight: "700" },
  headerStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  headerStatusLabel: { color: "#D1D5DB", fontSize: 11 },
  headerBuffer: { color: "#FB923C", fontSize: 11, fontWeight: "600" },
  bar: { flexDirection: "row", height: 4, backgroundColor: "#1F2937" },
  barDone: { backgroundColor: c.good },
  barMissed: { backgroundColor: c.bad },

  updateBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: sp.sm,
    height: 44,
    backgroundColor: c.brand,
  },
  updateLabel: { color: c.bk, fontSize: 13, fontWeight: "700" },

  section: { paddingHorizontal: sp.pad },
  block: { backgroundColor: c.surface, paddingVertical: 14, paddingHorizontal: sp.pad, gap: 10 },

  queueCard: { padding: sp.gap },
  queueRow: { flexDirection: "row", gap: sp.gap },
  queueText: { flex: 1, gap: 3 },

  mapLinks: { flexDirection: "row", gap: sp.sm },
  mapLink: {
    flex: 1,
    height: 48,
    borderRadius: r.btn,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: sp.xs,
  },
  mapLinkPrimary: { backgroundColor: c.info },
  mapLinkSecondary: { backgroundColor: c.infoBg },
  mapLinkLabel: { fontSize: 14, fontWeight: "700" },

  stops: { backgroundColor: c.surface },
  stop: { borderBottomWidth: 1, borderBottomColor: "#F1F1EF", paddingVertical: sp.gap, paddingHorizontal: sp.pad, gap: 10 },
  stopHead: { flexDirection: "row", gap: sp.gap, alignItems: "flex-start" },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  badgeNum: { fontSize: 14, fontWeight: "700", color: "#374151" },
  stopBody: { flex: 1, gap: 3 },
  stopNameRow: { flexDirection: "row", alignItems: "center", gap: sp.xs, flexWrap: "wrap" },
  stopName: { fontSize: 16, fontWeight: "600", color: c.text, flexShrink: 1 },
  stopAddress: { fontSize: 12, color: c.text3 },
  stopNote: { fontSize: 12, color: "#92400E" },
  stopMeta: { flexDirection: "row", gap: 10, flexWrap: "wrap", alignItems: "center" },
  metaPlain: { fontSize: 12, color: "#374151" },
  metaBad: { fontSize: 12, fontWeight: "600", color: c.badFg },
  metaGood: { fontSize: 12, fontWeight: "600", color: c.goodFg },
  metaWarn: { fontSize: 12, fontWeight: "600", color: c.warnFg },
  kind: { backgroundColor: "#FEF3C7", borderRadius: 4, paddingVertical: 1, paddingHorizontal: 6 },
  kindLabel: { fontSize: 11, fontWeight: "700", color: "#92400E" },

  panel: { gap: sp.sm },
  moneyRow: { flexDirection: "row", gap: sp.sm, alignItems: "center" },
  amount: { width: 96, textAlign: "center", fontWeight: "600" },
  ok: {
    height: 46,
    paddingHorizontal: sp.pad,
    borderRadius: r.sm,
    backgroundColor: c.good,
    alignItems: "center",
    justifyContent: "center",
  },
  okOff: { backgroundColor: "#E5E7EB" },
  okLabel: { fontSize: 14, fontWeight: "700", color: c.onDark },
  okLabelOff: { color: c.text3 },

  cashLine: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  cashCollected: { fontSize: 13, color: "#374151" },
  cashHanded: { fontSize: 13, color: c.text3 },
  cashHero: { flexDirection: "row", alignItems: "flex-end", gap: sp.xs },
  cashHeroLabel: { fontSize: 16, color: c.text2 },
  cashHeroValue: { fontSize: 28, fontWeight: "700", color: c.text },
  handover: {
    borderTopWidth: 1,
    borderTopColor: "#F1F1EF",
    paddingTop: sp.sm,
    gap: 2,
  },
  handoverTop: { flexDirection: "row", alignItems: "flex-end", gap: sp.xs },
  handoverAmount: { fontSize: 14, fontWeight: "600", color: c.text },
  handoverTime: { fontSize: 12, color: c.text3 },
  handoverOk: { fontSize: 12, fontWeight: "600", color: c.goodFg },
  handoverWait: { fontSize: 12, fontWeight: "600", color: c.warnFg },
  handoverForm: { borderTopWidth: 1, borderTopColor: "#F1F1EF", paddingTop: 10, gap: sp.sm },
  formLabel: { fontSize: 13, fontWeight: "600", color: "#374151" },
  amountBox: { borderRadius: r.sm, borderWidth: 1, borderColor: c.bk, overflow: "hidden" },
  amountBig: {
    height: 56,
    borderWidth: 0,
    borderRadius: 0,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
});
