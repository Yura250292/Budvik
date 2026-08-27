/**
 * Пошук по каталогу.
 *
 * Було: порожній аркуш до першого натиску, а далі одразу сітка з двадцяти
 * чотирьох карток. Тобто екран нічого не пропонував тому, хто ще не знає, як
 * назвати те, що шукає, і нічим не допомагав тому, хто шукає повторно.
 *
 * Тепер до набору тут історія запитів і найбільші розділи каталогу, а під час
 * набору — вісім рядків підказок із фото й ціною. Сітка карток лишилась
 * останнім кроком: коли запит широкий, людині потрібен список із фільтрами
 * (/list), а не двадцять чотири картки без керування.
 *
 * Запит іде на сервер із затримкою: людина набирає «перфоратор» дев'ятьма
 * натисками, і без паузи це були б дев'ять походів у базу.
 */

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, FlatList, StyleSheet, Pressable, ScrollView, Keyboard,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { api, API_BASE } from "@/api/client";
import { RowSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import {
  getHistory, pushHistory, removeFromHistory, clearHistory,
} from "@/lib/search-history";
import { colors, space, radius, formatUAH, formatPositions } from "@/theme";
import type { SuggestRow, SuggestFacet } from "@/api/types";

/** Та сама затримка, що в підказках на сайті (useSuggest). */
const DEBOUNCE_MS = 250;
/** Коротший запит нічого осмисленого не знайде, лише навантажить базу. */
const MIN_LENGTH = 2;
/** Скільки типів товарів пропонувати як «часте». Більше — вже стіна тексту. */
const POPULAR = 12;

type TocLine = { key: string; label: string; count: number };
type TocSection = { id: string; title: string; lines: TocLine[]; total: number };

export default function SearchScreen() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  /* Перечитуємо при поверненні на вкладку: людина могла шукати з головної,
     і історія без цього відставала б на один запит. */
  useFocusEffect(
    useCallback(() => {
      getHistory().then(setHistory);
    }, [])
  );

  const enabled = query.length >= MIN_LENGTH;

  const suggest = useQuery({
    queryKey: ["suggest", query],
    queryFn: () => api.suggest(query),
    enabled,
    /** Підказки живуть недовго: ціна й наявність міняються після кожного обміну. */
    staleTime: 60_000,
  });

  /**
   * «Часте» рахуємо з того, чого в каталозі найбільше, а не з вигаданого
   * списку: жодної статистики запитів ми не збираємо, і видавати редакційний
   * список за популярний було б неправдою. Ключ той самий, що на вкладці
   * «Каталог», тож зайвого запиту не буде.
   */
  const toc = useQuery({
    queryKey: ["catalog", "toc"],
    queryFn: async (): Promise<{ sections: TocSection[] }> => {
      const r = await fetch(`${API_BASE}/api/v1/catalog/toc`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 60 * 60_000,
  });

  const popular = (toc.data?.sections ?? [])
    .flatMap((s) => s.lines)
    .sort((a, b) => b.count - a.count)
    .slice(0, POPULAR);

  /** Запам'ятовуємо лише те, що людина довела до результату, а не кожен натиск. */
  async function commit(q: string) {
    const value = q.trim();
    if (value.length < MIN_LENGTH) return;
    Keyboard.dismiss();
    setHistory(await pushHistory(value));
    router.push({ pathname: "/list", params: { search: value } });
  }

  function repeat(q: string) {
    setText(q);
    setQuery(q);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <View style={styles.inputWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Назва або артикул"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => commit(text)}
          />
          {text ? (
            <Pressable onPress={() => setText("")} hitSlop={8} accessibilityLabel="Очистити поле">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Сканер поруч із пошуком: людина зі стендом у руках шукає не назвою. */}
        <Pressable
          style={styles.scanButton}
          onPress={() => router.push("/scan")}
          accessibilityLabel="Сканувати штрихкод"
        >
          <Ionicons name="barcode-outline" size={22} color={colors.ink} />
        </Pressable>
      </View>

      {!enabled ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.idle}>
          {history.length > 0 ? (
            <>
              <View style={styles.blockHead}>
                <Text style={styles.blockTitle}>Ви шукали</Text>
                <Pressable
                  onPress={() => clearHistory().then(() => setHistory([]))}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.clear}>Очистити</Text>
                </Pressable>
              </View>
              {history.map((q) => (
                <View key={q} style={styles.historyRow}>
                  <Pressable style={styles.historyMain} onPress={() => repeat(q)}>
                    <Ionicons name="time-outline" size={17} color={colors.textMuted} />
                    <Text style={styles.historyText} numberOfLines={1}>
                      {q}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => removeFromHistory(q).then(setHistory)}
                    hitSlop={10}
                    accessibilityLabel={`Прибрати «${q}» з історії`}
                  >
                    <Ionicons name="close" size={17} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </>
          ) : null}

          {popular.length > 0 ? (
            <>
              <View style={styles.blockHead}>
                <Text style={styles.blockTitle}>Чого найбільше</Text>
              </View>
              <View style={styles.chips}>
                {popular.map((line) => (
                  <Pressable
                    key={line.key}
                    style={styles.chip}
                    onPress={() =>
                      router.push({
                        pathname: "/list",
                        params: { type: line.key, title: line.label },
                      })
                    }
                    accessibilityLabel={`${line.label}, ${formatPositions(line.count)}`}
                  >
                    <Text style={styles.chipText}>{line.label}</Text>
                    <Text style={styles.chipCount}>{line.count}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Pressable style={styles.catalogLink} onPress={() => router.push("/catalog")}>
            <Ionicons name="albums-outline" size={18} color={colors.ink} />
            <Text style={styles.catalogText}>Весь каталог за розділами</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        </ScrollView>
      ) : suggest.isFetching && !suggest.data ? (
        <View style={{ padding: space.md }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : !suggest.data || suggest.data.items.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title={`Нічого не знайшли за «${query}»`}
          hint="Спробуйте коротший запит або одне слово — наприклад «дриль» замість «дриль ударний Bosch»."
        />
      ) : (
        <FlatList
          data={suggest.data.items}
          keyExtractor={(i) => i.id}
          /*
           * Уточнення над товарами, а не під ними.
           *
           * «Дриль» — це півтори сотні позицій, і людині потрібен не довший
           * список, а наступне питання: чий і який саме. Так влаштована
           * випадайка у великих магазинах техніки, і причина та сама: вісім
           * підказок не звужують нічого, а один дотик по «APRO» звужує вдвічі.
           */
          ListHeaderComponent={
            <FacetBlocks
              query={query}
              brands={suggest.data.brands}
              types={suggest.data.types}
            />
          }
          /**
           * Без цього перший дотик по результату лише ховає клавіатуру, а
           * картка не відкривається — людина тисне двічі й вважає, що
           * застосунок гальмує.
           */
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => <SuggestItem row={item} />}
          /* Рядок «усі результати» внизу, а не вгорі: спершу вісім конкретних
             товарів, і лише коли жоден не підійшов — ширша видача. */
          ListFooterComponent={
            <Pressable style={styles.allRow} onPress={() => commit(query)}>
              <Ionicons name="search" size={17} color={colors.ink} />
              <Text style={styles.allText}>Усі результати за «{query}»</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          }
        />
      )}
    </View>
  );
}

/** Уточнення над списком: бренди й типи серед знайденого. */
function FacetBlocks({
  query,
  brands,
  types,
}: {
  query: string;
  brands: SuggestFacet[];
  types: SuggestFacet[];
}) {
  const router = useRouter();
  if (brands.length === 0 && types.length === 0) return null;

  return (
    <View style={styles.facets}>
      {types.length > 0 ? (
        <>
          <Text style={styles.facetTitle}>Уточнити</Text>
          <View style={styles.chips}>
            {types.map((t) => (
              <Pressable
                key={`t-${t.key}`}
                style={styles.chip}
                onPress={() =>
                  router.push({
                    pathname: "/list",
                    params: { search: query, type: t.key, title: `${t.label} · ${query}` },
                  })
                }
              >
                <Text style={styles.chipText}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {brands.length > 0 ? (
        <>
          <Text style={styles.facetTitle}>Бренд</Text>
          <View style={styles.chips}>
            {brands.map((b) => (
              <Pressable
                key={`b-${b.key}`}
                style={styles.chip}
                onPress={() =>
                  router.push({
                    pathname: "/list",
                    params: { search: query, brand: b.key, title: `${b.label} · ${query}` },
                  })
                }
              >
                <Text style={styles.chipText}>{b.label}</Text>
                <Text style={styles.chipCount}>{b.count}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Рядок підказки: фото, назва, ярлик і ціна — рівно те, за чим упізнають товар. */
function SuggestItem({ row }: { row: SuggestRow }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(row.image) && !failed;

  return (
    <Pressable
      style={styles.suggestRow}
      onPress={() =>
        router.push({ pathname: "/product/[slug]", params: { slug: row.slug } })
      }
    >
      <View style={styles.thumb}>
        {showImage ? (
          <Image
            source={row.image}
            style={styles.thumbImage}
            alt=""
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={120}
            onError={() => setFailed(true)}
          />
        ) : (
          <Ionicons name="image-outline" size={20} color={colors.textMuted} />
        )}
      </View>

      <View style={{ flex: 1 }}>
        {row.label ? <Text style={styles.suggestLabel}>{row.label}</Text> : null}
        <Text style={styles.suggestName} numberOfLines={2}>
          {row.name}
        </Text>
        <View style={styles.suggestBottom}>
          <Text style={styles.suggestPrice}>{formatUAH(row.price)}</Text>
          {row.stock > 0 ? null : <Text style={styles.suggestOut}>немає в наявності</Text>}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  searchRow: { flexDirection: "row", gap: space.sm, padding: space.md },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, fontSize: 15, color: colors.text },
  scanButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },

  idle: { paddingBottom: space.xl },
  blockHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  blockTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  clear: { fontSize: 13, color: colors.textMuted },

  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: space.md,
  },
  historyMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
  historyText: { flex: 1, fontSize: 15, color: colors.text },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: { fontSize: 13, color: colors.text },
  chipCount: { fontSize: 11, color: colors.textMuted },

  catalogLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 52,
    marginTop: space.lg,
    marginHorizontal: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catalogText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.ink },

  facets: { paddingTop: space.sm, paddingBottom: space.xs },
  facetTitle: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.xs,
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
  },

  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 72,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImage: { width: "100%", height: "100%" },
  suggestLabel: { fontSize: 10, color: colors.textMuted, textTransform: "uppercase" },
  suggestName: { fontSize: 14, lineHeight: 18, color: colors.text },
  suggestBottom: { flexDirection: "row", alignItems: "baseline", gap: space.sm, marginTop: 2 },
  suggestPrice: { fontSize: 15, fontWeight: "800", color: colors.text },
  suggestOut: { fontSize: 11, color: colors.textMuted },

  allRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.md,
  },
  allText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.ink },
});
