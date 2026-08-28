/**
 * Картка товару.
 *
 * Секції опису приходять уже розібраними з сервера (splitDescription) — тим
 * самим кодом, що й на сайті, тож характеристики й комплектація виглядають
 * однаково в браузері й у застосунку.
 */

import { useEffect } from "react";
import { ScrollView, View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "@/api/client";
import { getToken } from "@/lib/auth-store";
import { ProductCard } from "@/components/ProductCard";
import { addToCart } from "@/lib/cart";
import { colors, space, radius, formatUAH } from "@/theme";

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();

  const navigation = useNavigation();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["product", slug],
    queryFn: () => api.product(slug),
  });

  /**
   * Обране питаємо лише в тих, хто увійшов: гостю 401 однаково нічого не дасть,
   * а клієнт на нього стирає токен — зайвий похід у мережу на кожній картці.
   */
  const { data: wishlist } = useQuery({
    queryKey: ["wishlist"],
    queryFn: async () => ((await getToken()) ? api.wishlist() : { items: [] }),
    retry: false,
  });

  const saved = !!data && !!wishlist?.items.some((i) => i.id === data.id);


  const toggle = useMutation({
    mutationFn: async () => {
      if (!data) return;
      if (!(await getToken())) throw new Error("NO_AUTH");
      return saved ? api.wishlistRemove(data.id) : api.wishlistAdd(data.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishlist"] }),
    onError: (e) => {
      if (e instanceof Error && e.message === "NO_AUTH") {
        router.push("/account");
      }
    },
  });

  /**
   * Заголовок і серце ставимо через navigation, а не <Stack.Screen>: екран
   * живе всередині навігатора вкладок, щоб нижня навігація лишалась на місці,
   * а Stack.Screen там не діє — і не скаржиться, що не діє.
   */
  useEffect(() => {
    navigation.setOptions({
      title: data?.brand ?? "Товар",
      headerRight: () =>
        data ? (
          <Pressable
            onPress={() => toggle.mutate()}
            hitSlop={12}
            style={styles.headerButton}
            accessibilityLabel={saved ? "Прибрати з обраного" : "Додати в обране"}
          >
            <Ionicons name={saved ? "heart" : "heart-outline"} size={24} color={colors.brand} />
          </Pressable>
        ) : null,
    });
  }, [navigation, data, saved, toggle]);

  if (isLoading) return <ActivityIndicator style={{ marginTop: space.xl }} color={colors.ink} />;
  if (error || !data) return <Text style={styles.hint}>Товар не знайдено</Text>;

  const pack = data.packQty && data.packQty > 1 ? data.packQty : null;
  const inStock = data.stock > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: space.xl * 2 }}>
        {data.image ? (
          <Image
            source={data.image}
            style={styles.image}
            alt={data.name}
            accessibilityLabel={data.name}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        ) : (
          /*
           * Місце під фото тримаємо навіть коли фото немає: інакше картка
           * товару без знімка починається одразу з назви й виглядає як
           * недовантажена сторінка, а не як товар без фото.
           */
          <View style={[styles.image, styles.noPhoto]}>
            <Ionicons name="image-outline" size={40} color={colors.textMuted} />
            <Text style={styles.noPhotoText}>Фото готуємо</Text>
          </View>
        )}

        <View style={styles.body}>
          {data.label ? <Text style={styles.label}>{data.label}</Text> : null}
          <Text style={styles.name}>{data.name}</Text>
          {data.sku ? <Text style={styles.sku}>Артикул: {data.sku}</Text> : null}

          <View style={styles.priceRow}>
            <Text style={[styles.price, data.basePrice ? styles.priceSale : null]}>
              {formatUAH(data.price)}
            </Text>
            {data.basePrice ? (
              <Text style={styles.priceBase}>{formatUAH(data.basePrice)}</Text>
            ) : null}
            {data.promoLabel ? <Text style={styles.promo}>{data.promoLabel}</Text> : null}
          </View>

          <Text style={[styles.stock, inStock ? styles.stockOk : styles.stockNo]}>
            {inStock ? `В наявності: ${data.stock} шт` : "Немає в наявності"}
          </Text>
          {pack ? <Text style={styles.pack}>Продається кратно {pack} шт</Text> : null}

          <Pressable
            style={[styles.cta, !inStock && styles.ctaOff]}
            disabled={!inStock}
            onPress={async () => {
              await addToCart(data, pack ?? 1);
              router.push("/cart");
            }}
          >
            <Text style={styles.ctaText}>{inStock ? "У кошик" : "Немає в наявності"}</Text>
          </Pressable>

          {data.sections.specs.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Характеристики</Text>
              {data.sections.specs.map((s) => (
                <View key={s.key} style={styles.specRow}>
                  <Text style={styles.specKey}>{s.key}</Text>
                  <Text style={styles.specValue}>{s.value}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {data.sections.kit.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Комплектація</Text>
              {data.sections.kit.map((line, i) => (
                <Text key={i} style={styles.kitLine}>
                  •  {line}
                </Text>
              ))}
            </View>
          ) : null}

          {data.sections.rest.trim() ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Опис</Text>
              <Text style={styles.sectionText}>{data.sections.rest.trim()}</Text>
            </View>
          ) : null}

          {data.related.length > 0 ? (
            <>
              <Text style={styles.relatedTitle}>Схоже з цього бренда</Text>
              <View style={styles.relatedRow}>
                {data.related.slice(0, 4).map((p) => (
                  <View key={p.id} style={{ width: "48%" }}>
                    <ProductCard product={p} />
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  image: { width: "100%", height: 260, backgroundColor: colors.surface },
  noPhoto: { alignItems: "center", justifyContent: "center", gap: space.sm },
  noPhotoText: { fontSize: 13, color: colors.textMuted },
  body: { padding: space.lg },
  label: { fontSize: 12, color: colors.textMuted, textTransform: "uppercase" },
  name: { marginTop: space.xs, fontSize: 18, fontWeight: "700", color: colors.text, lineHeight: 24 },
  sku: { marginTop: space.xs, fontSize: 12, color: colors.textMuted },
  priceRow: { marginTop: space.md, flexDirection: "row", alignItems: "baseline", gap: space.md, flexWrap: "wrap" },
  price: { fontSize: 26, fontWeight: "800", color: colors.text },
  priceSale: { color: colors.sale },
  priceBase: { fontSize: 15, color: colors.textMuted, textDecorationLine: "line-through" },
  promo: { fontSize: 12, color: colors.sale, fontWeight: "700" },
  stock: { marginTop: space.sm, fontSize: 13, fontWeight: "600" },
  stockOk: { color: colors.ok },
  stockNo: { color: colors.sale },
  pack: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  cta: {
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  ctaOff: { backgroundColor: colors.border },
  ctaText: { fontSize: 15, fontWeight: "700", color: colors.ink },
  section: { marginTop: space.xl },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: space.sm },
  sectionText: { fontSize: 14, lineHeight: 20, color: colors.text },
  specRow: {
    flexDirection: "row",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  specKey: { flex: 1, fontSize: 13, color: colors.textMuted },
  specValue: { flex: 1, fontSize: 13, color: colors.text, fontWeight: "600" },
  kitLine: { fontSize: 14, lineHeight: 21, color: colors.text },
  relatedTitle: { marginTop: space.xl, fontSize: 15, fontWeight: "700", color: colors.text },
  relatedRow: { marginTop: space.sm, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  hint: { padding: space.lg, color: colors.textMuted, textAlign: "center" },
  /** 44 — мінімальна ціль дотику; сама іконка менша, тож даємо площу навколо. */
  headerButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
