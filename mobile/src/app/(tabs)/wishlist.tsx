/**
 * Обране.
 *
 * Живе на сервері, а не на пристрої: список має пережити перевстановлення
 * застосунку й зміну телефона, інакше «збережене» виявляється не збереженим
 * саме тоді, коли по нього прийшли.
 */

import { View, Text, FlatList, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { addToCart } from "@/lib/cart";
import { EmptyState } from "@/components/EmptyState";
import { ProductGridSkeleton } from "@/components/Skeleton";
import { colors, space, radius } from "@/theme";

export default function WishlistScreen() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["wishlist"],
    queryFn: api.wishlist,
  });

  const remove = useMutation({
    mutationFn: api.wishlistRemove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishlist"] }),
  });

  if (isLoading) return <ProductGridSkeleton count={4} />;

  if (error) {
    return (
      <EmptyState
        icon="heart-outline"
        title="Обране зберігається в акаунті"
        hint="Увійдіть — і збережене буде з вами на будь-якому пристрої, навіть після перевстановлення."
        actionLabel="Увійти"
        onAction={() => router.push("/account")}
      />
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon="heart-outline"
        title="Поки що порожньо"
        hint="Натисніть серце на картці товару, щоб не шукати його знову."
        actionLabel="До каталогу"
        onAction={() => router.push("/catalog")}
      />
    );
  }

  return (
    <FlatList
      data={data.items}
      keyExtractor={(i) => i.id}
      numColumns={2}
      contentContainerStyle={{ padding: space.xs }}
      renderItem={({ item }) => (
        <View style={{ flex: 1 }}>
          <ProductCard product={item} onAdd={(p) => addToCart(p)} />
          <Pressable
            style={styles.remove}
            onPress={() => remove.mutate(item.id)}
            hitSlop={8}
          >
            <Ionicons name="close" size={14} color={colors.textMuted} />
            <Text style={styles.removeText}>Прибрати</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  hint: { color: colors.textMuted, textAlign: "center", fontSize: 14 },
  remove: { flexDirection: "row", alignItems: "center", gap: space.xs, justifyContent: "center", paddingBottom: space.sm },
  removeText: { fontSize: 11, color: colors.textMuted },
  button: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  buttonText: { fontWeight: "700", color: colors.ink },
});
