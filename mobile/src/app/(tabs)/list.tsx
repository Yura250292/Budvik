/**
 * Видача товарів — один екран на всі шляхи в каталог.
 *
 * Бренд, розділ, тип, пошук і будь-яка їх комбінація приходять сюди
 * параметрами адреси. Окремі екрани під кожен вхід означали б, що фільтр і
 * сортування треба писати тричі, а розійдуться вони на другому тижні.
 *
 * Параметри навмисно ті самі, що читає parseFilters() на сервері: brand,
 * type, search, sort, priceMin, priceMax, all. Застосунок нічого не
 * перекладає — що бачить людина у фільтрі, те й летить у запит.
 */

import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { ProductGridSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { FilterSheet, type Filters, countActive } from "@/components/FilterSheet";
import { addToCart } from "@/lib/cart";
import { colors, space, radius } from "@/theme";

const SORTS = [
  { key: "", label: "За популярністю" },
  { key: "price-asc", label: "Спершу дешевші" },
  { key: "price-desc", label: "Спершу дорожчі" },
  { key: "name-asc", label: "За назвою" },
  { key: "newest", label: "Новинки" },
] as const;

export default function ListScreen() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    brand?: string;
    type?: string;
    search?: string;
    title?: string;
  }>();

  /**
   * Фільтр, зібраний із параметрів адреси.
   *
   * Окремою функцією, бо потрібен двічі: на першій відмальовці й щоразу, коли
   * людина заходить у цей самий екран з іншого розділу.
   */
  const fromParams = (): Filters => ({
    brands: params.brand ? [params.brand] : [],
    types: params.type ? params.type.split(",") : [],
    priceMin: undefined,
    priceMax: undefined,
    inStockOnly: true,
    sort: "",
  });

  /**
   * Скидаємо фільтр, коли екран відкрили з іншими параметрами.
   *
   * Було: useState із початковим значенням із params — а він виконується лише
   * при монтуванні. Expo Router тримає /list одним екраном на всі входи, тож
   * при переході з «Малярного інструменту» в «Кріплення та метизи» params
   * мінялися, а filters лишалися від попереднього розділу. Заголовок при
   * цьому оновлювався (він читає params напряму), тож на екрані стояла нова
   * назва над старим списком — і виглядало це так, ніби застосунок завис.
   *
   * Правка стану просто у тілі відмальовки, а не в ефекті: React саме так і
   * радить скидати стан при зміні вхідних даних — зайвого проходу немає, а
   * ефект тут дав би зайву відмальовку старого списку перед новим.
   */
  const paramsKey = `${params.brand ?? ""}|${params.type ?? ""}|${params.search ?? ""}`;
  const [state, setState] = useState(() => ({ key: paramsKey, filters: fromParams() }));
  if (state.key !== paramsKey) setState({ key: paramsKey, filters: fromParams() });

  const filters = state.filters;
  /** Приймає і готове значення, і функцію-оновлювач — як звичайний setState. */
  const setFilters = (next: Filters | ((prev: Filters) => Filters)) =>
    setState((prev) => ({
      key: paramsKey,
      filters: typeof next === "function" ? next(prev.filters) : next,
    }));

  /**
   * Заголовок — те, звідки людина прийшла: назва бренда, розділу або сам
   * запит. Без нього екран називався б «Каталог» однаково для всіх шляхів, і
   * після трьох переходів незрозуміло, що саме зараз на екрані.
   */
  useEffect(() => {
    navigation.setOptions({
      title: params.title || (params.search ? `«${params.search}»` : "Каталог"),
    });
  }, [navigation, params.title, params.search]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  /** Те, що піде в запит. Порожні значення не додаємо — вони лише ламають кеш. */
  const query = useMemo(
    () => ({
      brand: filters.brands.join(",") || undefined,
      type: filters.types.join(",") || undefined,
      search: params.search || undefined,
      sort: filters.sort || undefined,
      priceMin: filters.priceMin,
      priceMax: filters.priceMax,
      // Сервер за замовчуванням показує лише наявне; «все» вмикається явно.
      all: filters.inStockOnly ? undefined : 1,
    }),
    [filters, params.search]
  );

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["catalog", "list", query],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.catalog({ ...query, page: pageParam }),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const isFuzzy = data?.pages[0]?.isFuzzy ?? false;
  const activeCount = countActive(filters);
  const sortLabel = SORTS.find((s) => s.key === filters.sort)?.label ?? SORTS[0].label;

  return (
    <View style={styles.screen}>
      {/*
        Панель керування завжди над списком, а не в шапці: до неї тягнуться
        після того, як побачили видачу, і на телефоні низ екрана ближчий за верх.
      */}
      <View style={styles.bar}>
        <Pressable style={styles.barButton} onPress={() => setSortOpen((v) => !v)}>
          <Ionicons name="swap-vertical-outline" size={17} color={colors.text} />
          <Text style={styles.barText} numberOfLines={1}>
            {sortLabel}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.barButton, activeCount > 0 && styles.barButtonOn]}
          onPress={() => setSheetOpen(true)}
        >
          <Ionicons name="options-outline" size={17} color={activeCount > 0 ? colors.ink : colors.text} />
          <Text style={[styles.barText, activeCount > 0 && styles.barTextOn]}>
            Фільтри{activeCount > 0 ? ` · ${activeCount}` : ""}
          </Text>
        </Pressable>
      </View>

      {sortOpen ? (
        <View style={styles.sortMenu}>
          {SORTS.map((s) => (
            <Pressable
              key={s.key}
              style={styles.sortItem}
              onPress={() => {
                setFilters((f) => ({ ...f, sort: s.key }));
                setSortOpen(false);
              }}
            >
              <Text style={[styles.sortText, filters.sort === s.key && styles.sortTextOn]}>
                {s.label}
              </Text>
              {filters.sort === s.key ? (
                <Ionicons name="checkmark" size={18} color={colors.ink} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {isLoading ? (
        <ProductGridSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon="cube-outline"
          title="Нічого не знайшли"
          hint={
            activeCount > 0
              ? "Спробуйте прибрати частину фільтрів — можливо, разом вони не лишають нічого."
              : "Спробуйте інший розділ або коротший запит."
          }
          actionLabel={activeCount > 0 ? "Скинути фільтри" : undefined}
          onAction={
            activeCount > 0
              ? () =>
                  setFilters({
                    brands: [],
                    types: [],
                    priceMin: undefined,
                    priceMax: undefined,
                    inStockOnly: true,
                    sort: filters.sort,
                  })
              : undefined
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          numColumns={2}
          contentContainerStyle={{ padding: space.xs }}
          ListHeaderComponent={
            <Text style={styles.count}>
              {isFuzzy ? "Точного збігу немає — показуємо схоже" : `Знайдено: ${total}`}
            </Text>
          }
          renderItem={({ item }) => <ProductCard product={item} onAdd={(p) => addToCart(p)} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListFooterComponent={
            isFetchingNextPage ? <ProductGridSkeleton count={2} /> : <View style={{ height: space.xl }} />
          }
        />
      )}

      <FilterSheet
        visible={sheetOpen}
        value={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: {
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  barButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    // 44 — мінімальна ціль дотику.
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  barButtonOn: { backgroundColor: colors.brand },
  barText: { fontSize: 13, color: colors.text, flexShrink: 1 },
  barTextOn: { fontWeight: "700", color: colors.ink },
  sortMenu: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  sortItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: space.lg,
  },
  sortText: { fontSize: 15, color: colors.text },
  sortTextOn: { fontWeight: "700" },
  count: { paddingHorizontal: space.sm, paddingVertical: space.sm, fontSize: 13, color: colors.textMuted },
});
