/**
 * Обране.
 *
 * Живе на сервері, а не на пристрої: список має пережити перевстановлення
 * застосунку й зміну телефона, інакше «збережене» виявляється не збереженим
 * саме тоді, коли по нього прийшли.
 */

import { View, Text, FlatList, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { addToCart } from "@/lib/cart";
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

  if (isLoading) return <ActivityIndicator style={{ marginTop: space.xl }} color={colors.ink} />;

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Щоб зберігати обране, увійдіть в акаунт</Text>
        <Pressable style={styles.button} onPress={() => router.push("/account")}>
          <Text style={styles.buttonText}>Увійти</Text>
        </Pressable>
      </View>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="heart-outline" size={48} color={colors.border} />
        <Text style={styles.hint}>Тут зʼявиться те, що ви збережете</Text>
      </View>
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
