/**
 * Товари одного бренда, з довантаженням сторінками.
 *
 * Пагінація, а не безкінечна вибірка: у великих брендів кілька тисяч позицій,
 * і тягнути їх одним запитом означало б секунди очікування на 3G заради
 * екрана, з якого людина зазвичай іде після першого ж рядка.
 */

import { useEffect } from "react";
import { FlatList, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { addToCart } from "@/lib/cart";
import { ProductGridSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { colors, space } from "@/theme";

export default function BrandScreen() {
  const { slug, name } = useLocalSearchParams<{ slug: string; name?: string }>();
  const navigation = useNavigation();

  /**
   * Заголовок ставимо через navigation, а не <Stack.Screen>: екран живе
   * всередині навігатора вкладок, щоб нижня навігація нікуди не зникала, а
   * Stack.Screen там просто не діє — мовчки, без помилки.
   */
  useEffect(() => {
    navigation.setOptions({ title: name ?? "Бренд" });
  }, [navigation, name]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["catalog", "brand", slug],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.catalog({ brand: slug, page: pageParam }),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      {isLoading ? (
        <ProductGridSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon="cube-outline"
          title="Зараз нічого немає в наявності"
          hint="Товари цього бренда закінчились. Загляньте пізніше або пошукайте схоже в іншому."
        />
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

