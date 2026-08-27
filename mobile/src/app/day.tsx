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
 */

import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Linking,
  RefreshControl,
} from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { staffApi, type DayResponse, type DayStop } from "@/api/staff";
import { colors, space, radius, formatUAH } from "@/theme";
import {
  flushPendingVisits,
  listPendingVisits,
  queueVisit,
  type PendingVisit,
} from "@/track/pending-visits";
import { googleMapsLinks, pointUrl } from "@/lib/google-links";

type Money = "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";

export default function DayScreen() {
  const [data, setData] = useState<DayResponse | null>(null);
  const [queued, setQueued] = useState<PendingVisit[]>([]);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Спершу віддати те, що лежить у черзі: інакше сервер поверне день без
    // відміток, які водій уже зробив, і вони «зникнуть» з екрана.
    await flushPendingVisits().catch(() => {});
    setQueued(await listPendingVisits());
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
    async (stop: DayStop, status: "DONE" | "MISSED", money: Money, extra?: { collectedAmount?: number; comment?: string }) => {
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
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Мій день" }} />
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  const p = data?.progress;
  const cash = data?.cash;

  return (
    <ScrollView
      contentContainerStyle={styles.page}
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
      <Stack.Screen options={{ title: "Мій день" }} />

      {/* Цифри великі: на них дивляться скоса, тримаючи кермо. */}
      <View style={styles.headerCard}>
        <Text style={styles.headerRoute}>
          {data?.route?.number ? `Маршрут ${data.route.number}` : "Маршрут не складено"}
        </Text>
        {p && (
          <>
            <Text style={styles.headerBig}>
              {p.done + p.missed} з {p.total}
            </Text>
            <View style={styles.bar}>
              <View
                style={[
                  styles.barFill,
                  { width: `${p.total ? ((p.done + p.missed) / p.total) * 100 : 0}%` },
                ]}
              />
            </View>
            <Text style={styles.headerMuted}>
              Зібрано {formatUAH(p.collected)} із запланованих {formatUAH(p.debtPlanned)}
            </Text>
          </>
        )}
        <Text style={styles.headerMuted}>
          Трек: {data?.track.distanceKm ?? 0} км · {data?.track.pointsCount ?? 0} точок
        </Text>
      </View>

      {queued.length > 0 && (
        <View style={[styles.card, styles.warn]}>
          <Text style={styles.cardTitle}>Чекає на мережу: {queued.length}</Text>
          <Text style={styles.muted}>
            Відмітки збережено на пристрої й показано як виконані. Надішлемо самі — тикати ще раз не
            треба.
          </Text>
        </View>
      )}

      {error && !data && (
        <View style={[styles.card, styles.warn]}>
          <Text style={styles.cardTitle}>Немає зв’язку</Text>
          <Text style={styles.muted}>
            День не завантажився. Маршрут і трек від цього не залежать — запис іде далі.
          </Text>
        </View>
      )}

      {mapLinks.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Дорога в Google Maps</Text>
          <Text style={styles.muted}>
            Через ще не відмічені точки. Google бере до десяти адрес на посилання, тож довгий день
            ділиться на частини.
          </Text>
          {mapLinks.map((l, i) => (
            <Pressable key={i} style={styles.secondary} onPress={() => Linking.openURL(l.url)}>
              <Text style={styles.secondaryText}>
                {mapLinks.length > 1 ? `Частина ${i + 1} — ${l.points} точок` : "Прокласти дорогу"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {stops.map((s) => (
        <StopCard
          key={s.key}
          stop={s}
          marked={isMarked(s)}
          queued={queuedKeys.has(s.key)}
          expanded={openKey === s.key}
          onToggle={() => setOpenKey(openKey === s.key ? null : s.key)}
          onMark={mark}
        />
      ))}

      {stops.length === 0 && !error && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>На сьогодні точок немає</Text>
          <Text style={styles.muted}>
            Маршрут складає логіст в адмінці. Якщо ви вже в дорозі — зателефонуйте в офіс.
          </Text>
        </View>
      )}

      {cash && <CashSection cash={cash} day={data?.day} onDone={load} />}
    </ScrollView>
  );
}

/* ---------- Точка маршруту ---------- */

function StopCard({
  stop,
  marked,
  queued,
  expanded,
  onToggle,
  onMark,
}: {
  stop: DayStop;
  marked: boolean;
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

  return (
    <View style={[styles.card, marked && styles.done]}>
      <Pressable onPress={onToggle}>
        <View style={styles.stopHead}>
          <Text style={styles.stopSeq}>{stop.sequence}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.stopName}>{stop.name}</Text>
            {!!stop.address && <Text style={styles.muted}>{stop.address}</Text>}
          </View>
        </View>
        <View style={styles.stopMeta}>
          {stop.amount > 0 && <Text style={styles.value}>{formatUAH(stop.amount)}</Text>}
          {stop.debtAmount > 0 && (
            <Text style={[styles.value, { color: colors.sale }]}>
              борг {formatUAH(stop.debtAmount)}
            </Text>
          )}
          {marked && (
            <Text style={[styles.value, { color: colors.ok }]}>
              {queued ? "збережено на пристрої" : stop.visit?.status === "MISSED" ? "не застав" : "виконано"}
            </Text>
          )}
        </View>
        {!!stop.notes && <Text style={styles.muted}>{stop.notes}</Text>}
      </Pressable>

      {stop.lat != null && stop.lng != null && (
        <Pressable
          style={styles.secondary}
          onPress={() => Linking.openURL(pointUrl({ lat: stop.lat as number, lng: stop.lng as number }))}
        >
          <Text style={styles.secondaryText}>Довези мене сюди</Text>
        </Pressable>
      )}

      {expanded && !marked && (
        <View style={styles.markPanel}>
          {isErrand ? (
            <>
              {/* Бонусна поїздка: без товару й без інкасації — лише факт. */}
              <Pressable style={styles.primary} onPress={() => onMark(stop, "DONE", "NOT_APPLICABLE", { comment })}>
                <Text style={styles.primaryText}>Виконано</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={() => onMark(stop, "MISSED", "NOT_APPLICABLE", { comment })}>
                <Text style={styles.secondaryText}>Не вийшло</Text>
              </Pressable>
            </>
          ) : (
            <>
              {stop.debtAmount > 0 && (
                <Pressable style={styles.primary} onPress={() => onMark(stop, "DONE", "FULL")}>
                  <Text style={styles.primaryText}>Забрав борг повністю ({formatUAH(stop.debtAmount)})</Text>
                </Pressable>
              )}
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="Часткова сума, ₴"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
              {!!amount && (
                <Pressable
                  style={styles.primary}
                  onPress={() =>
                    onMark(stop, "DONE", "PARTIAL", { collectedAmount: Number(amount.replace(",", ".")) })
                  }
                >
                  <Text style={styles.primaryText}>Забрав {amount} ₴</Text>
                </Pressable>
              )}
              <Pressable style={styles.secondary} onPress={() => onMark(stop, "DONE", "NONE")}>
                <Text style={styles.secondaryText}>Привіз, грошей не брав</Text>
              </Pressable>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Коментар (необов’язково)"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
              <Pressable
                style={styles.secondary}
                onPress={() => onMark(stop, "MISSED", "NOT_APPLICABLE", { comment })}
              >
                <Text style={styles.secondaryText}>Не застав</Text>
              </Pressable>
            </>
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
  cash: { collected: number; handed: number; onHands: number; handovers: { id: string; amount: number; confirmedAt: string | null }[] };
  day?: string;
  onDone: () => Promise<void>;
}) {
  // Сума наперед заповнена тим, що водій везе: зазвичай він просто підтверджує.
  const [amount, setAmount] = useState(cash.onHands > 0 ? String(cash.onHands) : "");
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
      await staffApi.cashHandover({ amount: value, day });
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
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Каса</Text>
      <View style={styles.row}>
        <Text style={styles.muted}>Зібрано</Text>
        <Text style={styles.value}>{formatUAH(cash.collected)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.muted}>Здано</Text>
        <Text style={styles.value}>{formatUAH(cash.handed)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.muted}>На руках</Text>
        <Text style={[styles.value, { color: cash.onHands > 0 ? colors.sale : colors.ok }]}>
          {formatUAH(cash.onHands)}
        </Text>
      </View>

      {cash.handovers.map((h) => (
        <View key={h.id} style={styles.row}>
          <Text style={styles.muted}>{h.confirmedAt ? "Прийнято офісом" : "Чекає підтвердження"}</Text>
          <Text style={styles.value}>{formatUAH(h.amount)}</Text>
        </View>
      ))}

      {cash.onHands > 0 && (
        <>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="Сума до здачі, ₴"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          {!!err && <Text style={[styles.muted, { color: colors.sale }]}>{err}</Text>}
          <Pressable style={styles.primary} onPress={submit} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? "Здаю…" : "Здати гроші"}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.md, gap: space.md, backgroundColor: colors.surface, flexGrow: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerCard: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  headerRoute: { color: colors.brand, fontSize: 13, fontWeight: "700" },
  headerBig: { color: "#FFFFFF", fontSize: 34, fontWeight: "800" },
  headerMuted: { color: "#9CA3AF", fontSize: 13 },
  bar: { height: 6, borderRadius: 3, backgroundColor: "#374151", overflow: "hidden", marginVertical: space.xs },
  barFill: { height: 6, backgroundColor: colors.brand },
  card: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  warn: { borderWidth: 1, borderColor: colors.brand },
  done: { opacity: 0.6 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  stopHead: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  stopSeq: { fontSize: 18, fontWeight: "800", color: colors.textMuted, minWidth: 26 },
  stopName: { fontSize: 16, fontWeight: "700", color: colors.text },
  stopMeta: { flexDirection: "row", gap: space.md, flexWrap: "wrap", marginTop: space.xs },
  markPanel: { gap: space.sm, marginTop: space.sm },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  muted: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  value: { fontSize: 14, fontWeight: "600", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 16,
    color: colors.text,
  },
  primary: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: "center" },
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
