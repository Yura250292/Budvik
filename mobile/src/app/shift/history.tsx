/**
 * Історія змін — те, що торговий питає найчастіше: скільки накатав за місяць.
 *
 * Екран був у Kotlin-трекері й без нього нова збірка не замінює стару. Тут
 * лише читання: виправляти минулі зміни може лише офіс, бо з них рахується
 * зарплата.
 */

import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { staffApi, type ShiftHistory, type ShiftRow } from "@/api/staff";
import { colors, space, radius } from "@/theme";

export default function ShiftHistoryScreen() {
  const [data, setData] = useState<ShiftHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await staffApi.shiftHistory());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Немає зв’язку");
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Історія змін" }} />
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  const s = data?.summary;

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
      <Stack.Screen options={{ title: "Історія змін" }} />

      {s && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>За останні 30 днів</Text>
          <Row label="Змін" value={String(s.count)} />
          <Row label="Пробіг" value={`${Math.round(s.totalKm)} км`} />
          <Row label="За кермом" value={`${Math.round(s.totalMinutes / 60)} год`} />
          {s.autoClosed > 0 && (
            <>
              <Row label="Закрилися самі" value={String(s.autoClosed)} />
              {/* Це не докір, а попередження: забуту зміну система закриває
                  сама, і пробіг у ній рахується не за одометром. */}
              <Text style={styles.muted}>
                Забуту зміну система закриває сама, і пробіг у ній рахується за GPS, а не за
                одометром. Закривайте зміну самі — так у розрахунку менше похибки.
              </Text>
            </>
          )}
        </View>
      )}

      {error && !data && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Немає зв’язку</Text>
          <Text style={styles.muted}>Історія завантажиться, щойно з’явиться мережа.</Text>
        </View>
      )}

      {data?.shifts.map((sh) => <ShiftCard key={sh.id} shift={sh} />)}

      {data?.shifts.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Змін ще не було</Text>
          <Text style={styles.muted}>Тут з’являться закриті зміни з пробігом і часом.</Text>
        </View>
      )}
    </ScrollView>
  );
}

function ShiftCard({ shift }: { shift: ShiftRow }) {
  const open = shift.status === "OPEN";
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.date}>{formatDay(shift.startedAt)}</Text>
        {open && <Text style={styles.badgeOpen}>відкрита</Text>}
        {shift.closedAutomatically && <Text style={styles.badgeWarn}>закрилася сама</Text>}
        {shift.odometerSuspicious && <Text style={styles.badgeWarn}>одометр під питанням</Text>}
      </View>

      <Row label="Час" value={`${formatTime(shift.startedAt)} — ${shift.endedAt ? formatTime(shift.endedAt) : "…"}`} />
      {shift.distanceKm != null && <Row label="Пробіг за одометром" value={`${shift.distanceKm} км`} />}
      {shift.gpsDistanceKm != null && <Row label="За GPS" value={`${shift.gpsDistanceKm} км`} />}
      {shift.personalKm != null && shift.personalKm > 0 && (
        <Row label="Особисті" value={`${shift.personalKm} км`} />
      )}
      {shift.startOdometer != null && (
        <Row
          label="Одометр"
          value={`${shift.startOdometer} → ${shift.endOdometer ?? "…"}`}
        />
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

/** Київський час: сервер віддає UTC, а людина живе за своїм годинником. */
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
      month: "long",
    });
  } catch {
    return "—";
  }
}

const styles = StyleSheet.create({
  page: { padding: space.md, gap: space.md, backgroundColor: colors.surface, flexGrow: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  date: { fontSize: 16, fontWeight: "700", color: colors.text },
  badgeOpen: { fontSize: 12, fontWeight: "700", color: colors.ok },
  badgeWarn: { fontSize: 12, fontWeight: "700", color: colors.sale },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  muted: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  value: { fontSize: 14, fontWeight: "600", color: colors.text },
});
