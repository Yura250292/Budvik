/**
 * Панель фільтрів.
 *
 * Знизу вгору, а не окремим екраном: людина має бачити, від чого відштовхується,
 * і повернутись до видачі одним жестом. Окремий екран у каталозі читається як
 * «я кудись пішов», і після нього завжди питання «а я повернувся туди ж?».
 *
 * Зміни застосовуються кнопкою, а не одразу. Це свідомо: кожен дотик по бренду
 * інакше перезапитував би видачу, а на списку з 280 брендів людина торкається
 * п'яти-шести поспіль.
 */

import { useState } from "react";
import {
  Modal, View, Text, Pressable, ScrollView, TextInput, Switch, StyleSheet, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/api/client";
import { colors, space, radius, formatUAH } from "@/theme";

export type Filters = {
  brands: string[];
  types: string[];
  priceMin?: number;
  priceMax?: number;
  inStockOnly: boolean;
  sort: string;
};

type Facets = {
  brands: { slug: string; name: string; count: number }[];
  types: { key: string; label: string; count: number }[];
  price: { min: number; max: number };
};

/** Скільки умов увімкнено — для підпису на кнопці. Сортування не рахуємо: воно окремо. */
export function countActive(f: Filters): number {
  return (
    f.brands.length +
    f.types.length +
    (f.priceMin !== undefined ? 1 : 0) +
    (f.priceMax !== undefined ? 1 : 0) +
    (f.inStockOnly ? 0 : 1)
  );
}

/** Скільки брендів показувати до натиску «показати всі». 280 списком — це стіна. */
const BRANDS_SHOWN = 12;

/**
 * Обгортка існує лише заради монтування.
 *
 * Тіло панелі створюється заново на кожне відкриття, тому початковий стан
 * чернетки і є поточним фільтром — без синхронізації ефектом. Ефект тут був би
 * гіршим не тільки за правилами хуків: він означав би, що між відкриттям і
 * синхронізацією є кадр зі старими значеннями.
 */
export function FilterSheet(props: {
  visible: boolean;
  value: Filters;
  onClose: () => void;
  onApply: (f: Filters) => void;
}) {
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      transparent
      onRequestClose={props.onClose}
    >
      {props.visible ? <SheetBody {...props} /> : null}
    </Modal>
  );
}

function SheetBody({
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  value: Filters;
  onClose: () => void;
  onApply: (f: Filters) => void;
}) {
  const [draft, setDraft] = useState<Filters>(value);
  const [allBrands, setAllBrands] = useState(false);

  const { data: facets, isLoading } = useQuery({
    queryKey: ["facets", draft.brands[0] ?? ""],
    queryFn: async (): Promise<Facets> => {
      const brand = draft.brands.length === 1 ? `?brand=${encodeURIComponent(draft.brands[0])}` : "";
      const res = await fetch(`${API_BASE}/api/v1/catalog/facets${brand}`);
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    staleTime: 60 * 60_000,
  });

  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  const brands = facets?.brands ?? [];
  const shown = allBrands ? brands : brands.slice(0, BRANDS_SHOWN);

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.sheet}>
        <View style={styles.head}>
          <Text style={styles.title}>Фільтри</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityLabel="Закрити">
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator style={{ margin: space.xl }} color={colors.ink} />
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Row
              label="Тільки в наявності"
              hint="Вимкніть, щоб побачити те, що можна взяти під замовлення"
            >
              <Switch
                value={draft.inStockOnly}
                onValueChange={(v) => setDraft({ ...draft, inStockOnly: v })}
                trackColor={{ true: colors.brand }}
              />
            </Row>

            <Text style={styles.section}>Ціна, ₴</Text>
            <View style={styles.priceRow}>
              <TextInput
                style={styles.priceInput}
                placeholder={facets ? String(facets.price.min) : "від"}
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={draft.priceMin?.toString() ?? ""}
                onChangeText={(t) =>
                  setDraft({ ...draft, priceMin: t ? Number(t.replace(/\D/g, "")) : undefined })
                }
              />
              <Text style={styles.dash}>—</Text>
              <TextInput
                style={styles.priceInput}
                placeholder={facets ? String(facets.price.max) : "до"}
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={draft.priceMax?.toString() ?? ""}
                onChangeText={(t) =>
                  setDraft({ ...draft, priceMax: t ? Number(t.replace(/\D/g, "")) : undefined })
                }
              />
            </View>
            {facets ? (
              <Text style={styles.hint}>
                У каталозі від {formatUAH(facets.price.min)} до {formatUAH(facets.price.max)}
              </Text>
            ) : null}

            {facets && facets.types.length > 0 ? (
              <>
                <Text style={styles.section}>Тип інструмента</Text>
                <View style={styles.chips}>
                  {facets.types.map((t) => (
                    <Chip
                      key={t.key}
                      label={`${t.label} · ${t.count}`}
                      on={draft.types.includes(t.key)}
                      onPress={() => setDraft({ ...draft, types: toggle(draft.types, t.key) })}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <Text style={styles.section}>Бренд</Text>
            <View style={styles.chips}>
              {shown.map((b) => (
                <Chip
                  key={b.slug}
                  label={`${b.name} · ${b.count}`}
                  on={draft.brands.includes(b.slug)}
                  onPress={() => setDraft({ ...draft, brands: toggle(draft.brands, b.slug) })}
                />
              ))}
            </View>
            {!allBrands && brands.length > BRANDS_SHOWN ? (
              <Pressable style={styles.more} onPress={() => setAllBrands(true)}>
                <Text style={styles.moreText}>Показати всі {brands.length} брендів</Text>
              </Pressable>
            ) : null}

            <View style={{ height: space.xl * 3 }} />
          </ScrollView>
        )}

        <View style={styles.foot}>
          <Pressable
            style={styles.reset}
            onPress={() =>
              setDraft({
                brands: [],
                types: [],
                priceMin: undefined,
                priceMax: undefined,
                inStockOnly: true,
                sort: draft.sort,
              })
            }
          >
            <Text style={styles.resetText}>Скинути</Text>
          </Pressable>

          <Pressable style={styles.apply} onPress={() => onApply(draft)}>
            <Text style={styles.applyText}>Показати</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    // Не на весь екран: смуга видачі зверху нагадує, до чого повернешся.
    height: "85%",
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  close: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  /**
   * Відступи саме на contentContainerStyle, а не на style: у ScrollView
   * перший відповідає за вміст, другий — за сам контейнер, і поле з flex:1
   * при другому варіанті рахує ширину без відступу й вилазить за екран.
   */
  body: { paddingHorizontal: space.lg },

  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  rowLabel: { fontSize: 15, color: colors.text },
  hint: { marginTop: 2, fontSize: 12, lineHeight: 17, color: colors.textMuted },

  section: { marginTop: space.lg, marginBottom: space.sm, fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  priceInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 15,
    color: colors.text,
  },
  dash: { color: colors.textMuted },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 13, color: colors.text },
  chipTextOn: { fontWeight: "700", color: colors.ink },
  more: { minHeight: 44, justifyContent: "center" },
  moreText: { fontSize: 14, color: colors.textMuted, textDecorationLine: "underline" },

  foot: {
    flexDirection: "row",
    gap: space.md,
    padding: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reset: {
    minHeight: 48,
    paddingHorizontal: space.xl,
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetText: { fontSize: 15, color: colors.text },
  apply: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  applyText: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
