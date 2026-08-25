/**
 * Головна.
 *
 * Два входи в каталог — пошук і сканер — і добірка того, що є в наявності.
 * Показуємо саме наявне: каталог, повний позицій, яких немає, справляє
 * враження великого й непрацюючого водночас.
 */

import { ScrollView, View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { addToCart } from "@/lib/cart";
import { colors, space, radius } from "@/theme";

export default function HomeScreen() {
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["catalog", "home"],
    queryFn: () => api.catalog({ sort: "newest" }),
  });

  return (
    <ScrollView style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>
          <Text style={styles.heroAccent}>БУДВІК27</Text> — ваш світ інструментів
        </Text>
        <Text style={styles.heroText}>
          Електро та ручний інструмент від провідних виробників
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={() => router.push("/search")}>
          <Ionicons name="search" size={22} color={colors.ink} />
          <Text style={styles.actionText}>Пошук</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => router.push("/scan")}>
          <Ionicons name="barcode-outline" size={22} color={colors.ink} />
          <Text style={styles.actionText}>Сканувати код</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => router.push("/catalog")}>
          <Ionicons name="grid" size={22} color={colors.ink} />
          <Text style={styles.actionText}>Бренди</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Нові надходження</Text>
      {isLoading ? (
        <ActivityIndicator style={{ margin: space.xl }} color={colors.ink} />
      ) : (
        <View style={styles.grid}>
          {(data?.items ?? []).slice(0, 8).map((p) => (
            <View key={p.id} style={{ width: "48%" }}>
              <ProductCard product={p} onAdd={(x) => addToCart(x)} />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hero: { padding: space.xl, backgroundColor: colors.ink },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#FFFFFF", lineHeight: 28 },
  heroAccent: { color: colors.brand },
  heroText: { marginTop: space.sm, color: "#D1D5DB", fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", gap: space.sm, padding: space.md },
  action: {
    flex: 1,
    alignItems: "center",
    gap: space.xs,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  actionText: { fontSize: 12, fontWeight: "700", color: colors.ink },
  sectionTitle: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    padding: space.sm,
  },
});
