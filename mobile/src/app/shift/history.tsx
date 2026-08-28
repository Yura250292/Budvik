/**
 * Історія змін — те, що торговий питає найчастіше: скільки накатав за місяць.
 *
 * Екран був у Kotlin-трекері й без нього нова збірка не замінює стару. Тут
 * лише читання: виправляти минулі зміни може лише офіс, бо з них рахується
 * зарплата.
 *
 * Верстка з макета: підсумок місяця плитками зверху, далі зміни картками. Мітки
 * («закрилася сама», «одометр під питанням») стоять біля дати навмисно — саме
 * вони пояснюють, чому в тій зміні пробіг інший, ніж людина пам'ятає.
 */

import {
  View,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  RefreshControl,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type ShiftRow } from "@/api/staff";
import { useShiftHistory, useRefetchOnFocus } from "@/api/staff-queries";
import { formatTime, formatDayMonthPadded } from "@/lib/format-date";
import { c, sp } from "@/ui/tokens";
import {
  Body,
  Card,
  CardTitle,
  Header,
  Note,
  Pill,
  Row,
  StatTile,
  TileRow,
} from "@/ui/kit";
import { Icon } from "@/ui/Icon";

export default function ShiftHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useShiftHistory();
  useRefetchOnFocus(query);

  const data = query.data ?? null;
  const error = query.isError
    ? query.error instanceof Error
      ? query.error.message
      : "Немає зв’язку"
    : null;

  if (query.isPending) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.bk} />
      </View>
    );
  }

  const sum = data?.summary;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Header title="Історія змін" eyebrow="Останні 30 днів" />

      {/* Список, а не суцільна прокрутка: за місяць тут набирається до
          тридцяти карток, і малювати їх усі заради першого екрана марно. */}
      <FlatList
        data={data?.shifts ?? []}
        keyExtractor={(sh) => sh.id}
        renderItem={({ item }) => (
          <ShiftCard shift={item} onOpen={() => router.push(`/shift/${item.id}`)} />
        )}
        ItemSeparatorComponent={() => <View style={s.gap} />}
        contentContainerStyle={[s.list, { paddingBottom: 24 + insets.bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => {
              query.refetch();
            }}
          />
        }
        ListHeaderComponent={
          <>
            {sum && (
              <Card gap={10}>
                <CardTitle>За останні 30 днів</CardTitle>
                {/*
                  Три плитки, а не чотири як у макеті: на 390 px четверта лишає під
                  число 67 px, і «2 640 км» зрізається до «2 …». Число, яке не
                  вміщається, гірше за число рядком — тому «закрились самі» стоїть
                  нижче звичайним рядком. Це й чесніше: це не показник роботи, а
                  попередження.
                */}
                <TileRow>
                  <StatTile label="Змін" value={String(sum.count)} />
                  <StatTile label="Пробіг" value={formatKm(sum.totalKm)} unit="км" />
                  <StatTile
                    label="За кермом"
                    value={String(Math.round(sum.totalMinutes / 60))}
                    unit="год"
                  />
                </TileRow>
                {sum.autoClosed > 0 && (
                  <Row label="Закрились самі" value={String(sum.autoClosed)} tone="bad" />
                )}
                {sum.autoClosed > 0 && (
                  // Це не докір, а попередження: забуту зміну система закриває
                  // сама, і пробіг у ній рахується не за одометром.
                  <Note>
                    Забуту зміну система закриває сама, і пробіг у ній рахується за GPS, а не за
                    одометром. Закривайте зміну самі — так у розрахунку менше похибки.
                  </Note>
                )}
              </Card>
            )}

            {error && !data && (
              <Card tone="warn">
                <CardTitle>Немає зв’язку</CardTitle>
                <Body>Історія завантажиться, щойно з’явиться мережа.</Body>
              </Card>
            )}

            {(sum || (error && !data)) && <View style={s.gap} />}
          </>
        }
        ListEmptyComponent={
          data?.shifts.length === 0 ? (
            <Card>
              <CardTitle>Змін ще не було</CardTitle>
              <Body>Тут з’являться закриті зміни з пробігом і часом.</Body>
            </Card>
          ) : null
        }
      />
    </>
  );
}

function ShiftCard({ shift, onOpen }: { shift: ShiftRow; onOpen: () => void }) {
  const open = shift.status === "OPEN";
  return (
    <Card gap={sp.xs}>
      {/* Уся картка — вхід у деталі: там фото приладу й схема треку, тобто
          відповідь на «звідки взявся цей пробіг». */}
      <Pressable style={({ pressed }) => [s.head, pressed && { opacity: 0.6 }]} onPress={onOpen}>
        <View style={s.headLeft}>
          <CardTitle>{formatDayMonthPadded(shift.startedAt)}</CardTitle>
          {open && <Pill tone="good" dot={false} label="відкрита" />}
          {shift.closedAutomatically && <Pill tone="bad" dot={false} label="закрилася сама" />}
          {shift.odometerSuspicious && (
            <Pill tone="warn" dot={false} label="одометр під питанням" />
          )}
        </View>
        <Icon name="chevron-right" size={18} color={c.text3} />
      </Pressable>

      <Row
        label="Час"
        value={`${formatTime(shift.startedAt)} — ${shift.endedAt ? formatTime(shift.endedAt) : "…"}`}
      />
      {shift.distanceKm != null && <Row label="Пробіг за одометром" value={`${shift.distanceKm} км`} />}
      {shift.gpsDistanceKm != null && <Row label="За GPS" value={`${formatDec(shift.gpsDistanceKm)} км`} />}
      {shift.personalKm != null && shift.personalKm > 0 && (
        <Row label="Особисті" value={`${shift.personalKm} км`} tone="muted" />
      )}
      {shift.startOdometer != null && (
        <Row
          label="Одометр"
          value={`${formatKm(shift.startOdometer)} → ${
            shift.endOdometer != null ? formatKm(shift.endOdometer) : "…"
          }`}
        />
      )}
    </Card>
  );
}

function formatKm(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatDec(n: number): string {
  return String(n).replace(".", ",");
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  /** Ті самі поля й проміжки, що дає Screen: список їх не успадковує. */
  list: { padding: sp.pad, backgroundColor: c.bg, flexGrow: 1 },
  gap: { height: sp.gap },
  head: { flexDirection: "row", alignItems: "center", gap: sp.sm },
  headLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: sp.sm, flexWrap: "wrap" },
});
