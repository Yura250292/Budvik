/**
 * Каталог — списком брендів, а не категорій.
 *
 * Категорійне дерево приїжджає з 1С і покупцю нічого не пояснює: 84% товарів
 * лежать у звалищі «Імпорт з 1С», а решта груп називається числами. Бренд
 * заповнений майже скрізь, і саме за брендом інструмент і шукають.
 */

import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/api/client";
import { colors, space, radius } from "@/theme";

type Brand = { slug: string; name: string; count: number };
type BrandTree = { main: Brand[]; tail: Brand[]; unbranded: number; total: number };

export default function CatalogScreen() {
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ["brands"],
    queryFn: async (): Promise<BrandTree> => {
      const res = await fetch(`${API_BASE}/api/v1/brands`);
      if (!res.ok) throw new Error(`Сервер відповів ${res.status}`);
      return res.json();
    },
    // Структура каталогу змінюється не частіше, ніж приїжджає обмін із 1С.
    staleTime: 60 * 60_000,
  });

  if (isLoading) return <ActivityIndicator style={{ marginTop: space.xl }} color={colors.ink} />;
  if (error) return <Text style={styles.hint}>Не вдалося завантажити каталог</Text>;

  // Хвіст — дрібні бренди на кілька позицій. Показуємо їх нижче, а не ховаємо:
  // саме там трапляється те, чого немає в інших.
  const brands = [...(data?.main ?? []), ...(data?.tail ?? [])];

  return (
    <FlatList
      data={brands}
      keyExtractor={(b) => b.slug}
      contentContainerStyle={{ padding: space.md }}
      ListHeaderComponent={
        data ? <Text style={styles.total}>Усього позицій: {data.total}</Text> : null
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() =>
            router.push({ pathname: "/brand/[slug]", params: { slug: item.slug, name: item.name } })
          }
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.count}>{item.count} позицій</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  total: { marginBottom: space.md, color: colors.textMuted, fontSize: 13 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: space.md,
    marginBottom: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  name: { fontSize: 15, fontWeight: "600", color: colors.text },
  count: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  hint: { padding: space.lg, color: colors.textMuted, textAlign: "center" },
});
