/**
 * Товари одного бренда, з довантаженням сторінками.
 *
 * Пагінація, а не безкінечна вибірка: у великих брендів кілька тисяч позицій,
 * і тягнути їх одним запитом означало б секунди очікування на 3G заради
 * екрана, з якого людина зазвичай іде після першого ж рядка.
 */

import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { addToCart } from "@/lib/cart";
import { colors, space } from "@/theme";

export default function BrandScreen() {
  const { slug, name } = useLocalSearchParams<{ slug: string; name?: string }>();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["catalog", "brand", slug],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.catalog({ brand: slug, page: pageParam }),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <Stack.Screen options={{ title: name ?? "Бренд" }} />
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: space.xl }} color={colors.ink} />
      ) : items.length === 0 ? (
        <Text style={styles.hint}>У цьому бренді зараз немає нічого в наявності</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          numColumns={2}
          contentContainerStyle={{ padding: space.xs }}
          renderItem={({ item }) => <ProductCard product={item} onAdd={(p) => addToCart(p)} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ margin: space.lg }} color={colors.ink} />
            ) : null
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  hint: { padding: space.lg, color: colors.textMuted, textAlign: "center" },
});
