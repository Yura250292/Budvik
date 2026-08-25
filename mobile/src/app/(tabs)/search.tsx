/**
 * Пошук по каталогу.
 *
 * Запит іде на сервер із затримкою: людина набирає «перфоратор» дев'ятьма
 * натисками, і без паузи це були б дев'ять походів у базу, кожен із власним
 * ILIKE по 49 тисячах рядків.
 */

import { useState, useEffect } from "react";
import { View, Text, TextInput, FlatList, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { addToCart } from "@/lib/cart";
import { ProductGridSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { colors, space, radius } from "@/theme";

/** Та сама затримка, що в підказках на сайті (useSuggest). */
const DEBOUNCE_MS = 250;
/** Коротший запит нічого осмисленого не знайде, лише навантажить базу. */
const MIN_LENGTH = 2;

export default function SearchScreen() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  const enabled = query.length >= MIN_LENGTH;
  const { data, isFetching } = useQuery({
    queryKey: ["catalog", "search", query],
    queryFn: () => api.catalog({ search: query }),
    enabled,
  });

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
            onSubmitEditing={() => {
              /*
               * Enter відкриває повну видачу з фільтрами й сортуванням.
               * Підказки під полем лишаються для швидкого влучання в товар,
               * але коли запит широкий, людині потрібен саме список із
               * фільтрами, а не двадцять чотири картки без керування.
               */
              if (text.trim().length >= MIN_LENGTH) {
                router.push({ pathname: "/list", params: { search: text.trim() } });
              }
            }}
          />
          {text ? (
            <Pressable onPress={() => setText("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Сканер поруч із пошуком: людина зі стенда в руках шукає не назвою. */}
        <Pressable
          style={styles.scanButton}
          onPress={() => router.push("/scan")}
          accessibilityLabel="Сканувати штрихкод"
        >
          <Ionicons name="barcode-outline" size={22} color={colors.ink} />
        </Pressable>
      </View>

      {!enabled ? (
        <EmptyState
          icon="search-outline"
          title="Що шукаємо?"
          hint="Введіть назву або артикул — наприклад «дриль» чи «830408». Або відкрийте каталог за розділами."
          actionLabel="До каталогу"
          onAction={() => router.push("/catalog")}
        />
      ) : isFetching && !data ? (
        <ProductGridSkeleton />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title={`Нічого не знайшли за «${query}»`}
          hint="Спробуйте коротший запит або одне слово — наприклад «дриль» замість «дриль ударний Bosch»."
        />
      ) : (
        <>
          {data.isFuzzy ? (
            <Text style={styles.fuzzy}>Точного збігу немає — показуємо схоже</Text>
          ) : (
            <Text style={styles.count}>Знайдено: {data.total}</Text>
          )}
          <FlatList
            data={data.items}
            keyExtractor={(i) => i.id}
            numColumns={2}
            contentContainerStyle={{ padding: space.xs }}
            /**
             * Без цього перший дотик по результату лише ховає клавіатуру, а
             * картка не відкривається — людина тисне двічі й вважає, що
             * застосунок гальмує.
             */
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item }) => (
              <ProductCard product={item} onAdd={(p) => addToCart(p)} />
            )}
          />
        </>
      )}
    </View>
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
  hint: { padding: space.lg, color: colors.textMuted, textAlign: "center" },
  count: { paddingHorizontal: space.md, color: colors.textMuted, fontSize: 13 },
  fuzzy: { paddingHorizontal: space.md, color: colors.sale, fontSize: 13 },
});
