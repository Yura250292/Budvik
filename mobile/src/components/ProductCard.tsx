/**
 * Картка товару в списку.
 *
 * Показує рівно те, що вирішив сервер: price уже з урахуванням акції, а
 * basePrice приходить лише тоді, коли є що закреслити. Застосунок не рахує
 * знижки сам — інакше він і сайт неминуче розійшлися б у цифрах.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, space, radius, formatUAH } from "@/theme";
import type { CardDto } from "@/api/types";

export function ProductCard({
  product,
  onAdd,
}: {
  product: CardDto;
  onAdd?: (p: CardDto) => void;
}) {
  const pack = product.packQty && product.packQty > 1 ? product.packQty : null;

  return (
    <Link href={{ pathname: "/product/[slug]", params: { slug: product.slug } }} asChild>
      <Pressable style={styles.card}>
        {product.image ? (
          <Image
            source={product.image}
            style={styles.image}
            // Зчитувач екрана інакше промовляє «зображення» без жодного змісту.
            alt={product.name}
            accessibilityLabel={product.name}
            contentFit="contain"
            // Дисковий кеш expo-image і є офлайн-режимом для фото: URL у базі
            // ведуть на різні хости, і покладатися на їхні заголовки не можна.
            cachePolicy="memory-disk"
            transition={150}
          />
        ) : (
          <View style={[styles.image, styles.noPhoto]}>
            <Ionicons name="image-outline" size={28} color={colors.textMuted} />
          </View>
        )}

        {product.label ? <Text style={styles.label}>{product.label}</Text> : null}

        <Text style={styles.name} numberOfLines={3}>
          {product.name}
        </Text>

        <View style={styles.priceRow}>
          <Text style={[styles.price, product.basePrice ? styles.priceSale : null]}>
            {formatUAH(product.price)}
          </Text>
          {product.basePrice ? (
            <Text style={styles.priceBase}>{formatUAH(product.basePrice)}</Text>
          ) : null}
        </View>

        {pack ? <Text style={styles.pack}>Кратно {pack} шт</Text> : null}

        {onAdd ? (
          <Pressable
            style={styles.button}
            onPress={(e) => {
              // Кнопка живе всередині картки-посилання: без цього натиск
              // одночасно кладе товар у кошик і відкриває картку.
              e.stopPropagation();
              onAdd(product);
            }}
          >
            <Text style={styles.buttonText}>У кошик</Text>
          </Pressable>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: space.xs,
    padding: space.sm,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: "100%", height: 120, borderRadius: radius.sm, backgroundColor: colors.surface },
  noPhoto: { alignItems: "center", justifyContent: "center" },
  label: { marginTop: space.sm, fontSize: 11, color: colors.textMuted, textTransform: "uppercase" },
  name: { marginTop: space.xs, fontSize: 13, lineHeight: 17, color: colors.text },
  priceRow: { marginTop: space.sm, flexDirection: "row", alignItems: "baseline", gap: space.sm },
  price: { fontSize: 16, fontWeight: "700", color: colors.text },
  priceSale: { color: colors.sale },
  priceBase: { fontSize: 12, color: colors.textMuted, textDecorationLine: "line-through" },
  pack: { marginTop: 2, fontSize: 11, color: colors.textMuted },
  button: {
    marginTop: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  buttonText: { fontWeight: "700", color: colors.ink, fontSize: 13 },
});
