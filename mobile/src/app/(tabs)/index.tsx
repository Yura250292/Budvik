/**
 * Головна: банери, полиці й швидкі входи.
 *
 * Усе приходить одним запитом /api/v1/home — п'ять окремих походів по мережі
 * означали б, що екран збирається шматками, і на слабкому звʼязку це секунди
 * блимання.
 *
 * Сканера тут немає навмисно. Він потрібен людині, яка стоїть у магазині з
 * коробкою в руках, а не тій, що гортає каталог із дивана; його місце — поруч
 * із полем пошуку, де він і лишився. На головній він займав третину смуги дій,
 * відповідаючи на питання, якого в цей момент ніхто не ставить.
 */

import { ScrollView, View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { ProductGridSkeleton } from "@/components/Skeleton";
import { addToCart } from "@/lib/cart";
import type { CardDto } from "@/api/types";
import { colors, space, radius } from "@/theme";

type Banner = {
  id: string;
  title: string;
  subtitle: string | null;
  icon: string;
  color: string;
  search: string;
};
type Shelf = { id: string; title: string; items: CardDto[] };
type Home = {
  banners: Banner[];
  shelves: Shelf[];
  brands: { slug: string; name: string; count: number }[];
};

export default function HomeScreen() {
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["home"],
    queryFn: async (): Promise<Home> => {
      const r = await fetch(`${API_BASE}/api/v1/home`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 10 * 60_000,
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: space.xl }}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>
          <Text style={styles.heroAccent}>БУДВІК27</Text> — ваш світ інструментів
        </Text>
        <Text style={styles.heroText}>Електро та ручний інструмент від провідних виробників</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={() => router.push("/search")}>
          <Ionicons name="search" size={20} color={colors.ink} />
          <Text style={styles.actionText}>Пошук</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => router.push("/catalog")}>
          <Ionicons name="grid" size={20} color={colors.ink} />
          <Text style={styles.actionText}>Каталог</Text>
        </Pressable>
      </View>

      {/* Банери горизонтально: їх зазвичай один-два, але їх кількість —
          рішення маркетингу, і вертикальний список з'їдав би екран цілком. */}
      {data?.banners.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bannerRow}
        >
          {data.banners.map((b) => (
            <Pressable
              key={b.id}
              style={[styles.banner, { backgroundColor: b.color }]}
              onPress={() =>
                router.push({ pathname: "/list", params: { search: b.search, title: b.title } })
              }
            >
              <Text style={styles.bannerIcon}>{b.icon}</Text>
              <Text style={styles.bannerTitle}>{b.title}</Text>
              {b.subtitle ? <Text style={styles.bannerText}>{b.subtitle}</Text> : null}
              <View style={styles.bannerCta}>
                <Text style={styles.bannerCtaText}>Дивитись</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.ink} />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Бренди стрічкою: швидкий вхід для тих, хто вже знає, чий інструмент бере. */}
      {data?.brands.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {data.brands.map((b) => (
            <Pressable
              key={b.slug}
              style={styles.chip}
              onPress={() =>
                router.push({ pathname: "/list", params: { brand: b.slug, title: b.name } })
              }
            >
              <Text style={styles.chipText}>{b.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {isLoading ? (
        <ProductGridSkeleton count={4} />
      ) : (
        data?.shelves.map((shelf) => (
          <View key={shelf.id}>
            <View style={styles.shelfHead}>
              <Text style={styles.shelfTitle}>{shelf.title}</Text>
            </View>
            <View style={styles.grid}>
              {shelf.items.map((p) => (
                <View key={p.id} style={{ width: "48%" }}>
                  <ProductCard product={p} onAdd={(x) => addToCart(x)} />
                </View>
              ))}
            </View>
          </View>
        ))
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  actionText: { fontSize: 14, fontWeight: "700", color: colors.ink },

  bannerRow: { paddingHorizontal: space.md, gap: space.md, paddingBottom: space.md },
  banner: { width: 280, padding: space.lg, borderRadius: radius.lg, gap: space.xs },
  bannerIcon: { fontSize: 26 },
  bannerTitle: { fontSize: 17, fontWeight: "800", color: colors.ink },
  bannerText: { fontSize: 13, lineHeight: 18, color: colors.ink, opacity: 0.75 },
  bannerCta: { marginTop: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs },
  bannerCtaText: { fontSize: 13, fontWeight: "700", color: colors.ink },

  chipRow: { paddingHorizontal: space.md, gap: space.sm, paddingBottom: space.md },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.text },

  shelfHead: { paddingHorizontal: space.md, paddingTop: space.md },
  shelfTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    padding: space.sm,
  },
});
