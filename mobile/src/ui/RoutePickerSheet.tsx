/**
 * Вибір маршрутного листа в застосунку водія.
 *
 * У WebView-кабінеті така шторка вже була (src/components/driver/RoutePicker.tsx),
 * а на нативному екрані дня вибору не існувало зовсім: заголовок «Маршрут
 * 000001854» був простим текстом, і єдиний спосіб відкрити інший лист —
 * піти в карту, вибрати там і повернутися. Тепер заголовок тапається.
 *
 * У списку не лише свої листи, а й колег (вимога власника): водій-підмінник
 * і той, хто вперше їде чужим районом, мусять бачити, що везуть інші, і
 * могти скласти собі по їхньому листу дорогу. Свої йдуть першими, з жовтою
 * смугою і бейджем «мій»; у чужих на місці бейджа стоїть ім'я власника.
 * Різниця мусить читатися боковим зором: у чужому листі відмічати не можна,
 * і зрозуміти це треба ДО тапу, а не після.
 *
 * Верстка повторює веб-шторку навмисно — це той самий список, і людина не
 * має вчити його двічі.
 */

import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverRouteItem } from "@/api/staff";
import { formatRouteDay } from "@/lib/format-date";
import { formatUAH } from "@/theme";
import { c, r, sp } from "@/ui/tokens";
import { Icon } from "@/ui/Icon";

export function RoutePickerSheet({
  visible,
  current,
  today,
  items,
  loading,
  error,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** Ключ відкритого зараз листа. null — сьогоднішній, який знайшов сервер. */
  current: string | null;
  today: string;
  items: DriverRouteItem[] | undefined;
  loading: boolean;
  error: boolean;
  /** null повертає кабінет до сьогоднішнього маршруту. */
  onPick: (key: string | null) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  /** «Всі» за замовчуванням: заради чужих листів шторку й додавали. */
  const [only, setOnly] = useState<"all" | "mine">("all");

  // Фільтр на пристрої: список уже приїхав цілком, і похід у мережу на
  // перемикання двох кнопок за кермом коштував би секунд.
  const shown = useMemo(
    () => (only === "mine" ? (items ?? []).filter((i) => i.mine) : (items ?? [])),
    [items, only]
  );
  const hasForeign = (items ?? []).some((i) => !i.mine);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        {/* Зупиняємо тап на самій картці — інакше вибір закривав би шторку
            ще до того, як спрацював рядок. */}
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom }]} onPress={() => {}}>
          <View style={s.head}>
            <Text style={s.title}>Маршрутні листи</Text>
            {hasForeign && (
              <View style={s.pick}>
                {(["all", "mine"] as const).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setOnly(k)}
                    accessibilityState={{ selected: only === k }}
                    style={[s.pickItem, only === k && s.pickItemOn]}
                  >
                    <Text style={[s.pickLabel, only === k && s.pickLabelOn]}>
                      {k === "all" ? "Всі" : "Мої"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable onPress={onClose} accessibilityLabel="Закрити" style={s.close} hitSlop={8}>
              <Icon name="x" size={20} color={c.text2} />
            </Pressable>
          </View>

          {loading && !items && (
            <View style={s.state}>
              <ActivityIndicator color={c.bk} />
            </View>
          )}

          {error && !items && (
            <Text style={[s.state, s.stateText]}>
              Список не завантажився. Маршрут, відкритий зараз, від цього не залежить.
            </Text>
          )}

          {items && shown.length === 0 && (
            <Text style={[s.state, s.stateText]}>
              {only === "mine" && items.length > 0
                ? "Ваших листів у цьому періоді немає — але є листи колег, перемкніть на «Всі»."
                : "Переданих маршрутів поки немає. Лист складає логіст — він з’явиться тут сам."}
            </Text>
          )}

          <FlatList
            data={shown}
            keyExtractor={(it) => it.key}
            style={s.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: it }) => {
              const on = current === it.key;
              return (
                <Pressable
                  onPress={() => onPick(it.key)}
                  style={[
                    s.row,
                    // Своє — жовта смуга зліва; чуже — приглушений фон.
                    { borderLeftColor: it.mine ? c.brand : "transparent" },
                    on && s.rowOn,
                    !it.mine && !on && s.rowForeign,
                  ]}
                >
                  <View style={s.rowTop}>
                    <Text style={s.rowDay}>{formatRouteDay(it.day, today)}</Text>
                    <Text style={s.rowNumber}>{it.number}</Text>
                    {it.source === "ROUTE_SHEET" && <Text style={s.rowTag}>лист 1С</Text>}
                    {on && <Text style={s.rowOpen}>відкрито</Text>}
                  </View>
                  <View style={s.rowMeta}>
                    {it.mine ? (
                      <Text style={s.rowMine}>мій</Text>
                    ) : (
                      <Text style={s.rowOwner} numberOfLines={1}>
                        {it.driverName ?? "без водія"}
                      </Text>
                    )}
                    <Text style={s.rowMetaText}>
                      {it.done} з {it.stops} точок
                    </Text>
                    {it.amount > 0 && <Text style={s.rowMetaText}>{formatUAH(it.amount)}</Text>}
                    {it.plannedKm != null && it.plannedKm > 0 && (
                      <Text style={s.rowMetaText}>
                        {String(Math.round(it.plannedKm)).replace(".", ",")} км
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            }}
          />

          {!!current && (
            <Pressable onPress={() => onPick(null)} style={s.footer}>
              <Text style={s.footerLabel}>Повернутись до сьогоднішнього</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10,10,10,0.45)" },
  sheet: {
    maxHeight: "80%",
    backgroundColor: c.surface,
    borderTopLeftRadius: r.card,
    borderTopRightRadius: r.card,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: sp.sm,
    paddingHorizontal: sp.pad,
    paddingVertical: sp.gap,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  title: { flex: 1, fontSize: 16, fontWeight: "700", color: c.text },
  close: { minWidth: 44, minHeight: 36, alignItems: "flex-end", justifyContent: "center" },
  pick: { flexDirection: "row", gap: 2, padding: 2, borderRadius: r.chip, backgroundColor: c.bg },
  pickItem: { minHeight: 30, paddingHorizontal: 12, justifyContent: "center", borderRadius: r.chip },
  pickItemOn: { backgroundColor: c.bk },
  pickLabel: { fontSize: 12, fontWeight: "700", color: c.text2 },
  pickLabelOn: { color: c.onDark },

  state: { paddingHorizontal: sp.pad, paddingVertical: sp.pad },
  stateText: { fontSize: 13, lineHeight: 19, color: c.text2 },

  list: { flexGrow: 0 },
  row: {
    paddingHorizontal: sp.pad,
    paddingVertical: sp.gap,
    borderLeftWidth: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
    backgroundColor: c.surface,
  },
  rowOn: { backgroundColor: c.warnBg },
  rowForeign: { backgroundColor: "#FAFAF9" },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: sp.sm },
  rowDay: { fontSize: 15, fontWeight: "700", color: c.text },
  rowNumber: { fontSize: 13, color: c.text2 },
  rowTag: { fontSize: 11, color: c.text3 },
  rowOpen: { marginLeft: "auto", fontSize: 12, fontWeight: "700", color: c.warn },
  rowMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: sp.gap, marginTop: 3 },
  rowMine: { fontSize: 12.5, fontWeight: "700", color: c.text },
  rowOwner: { fontSize: 12.5, fontWeight: "600", color: "#374151", maxWidth: 160 },
  rowMetaText: { fontSize: 12.5, color: c.text2 },

  footer: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.line,
  },
  footerLabel: { fontSize: 14, fontWeight: "700", color: c.info },
});
