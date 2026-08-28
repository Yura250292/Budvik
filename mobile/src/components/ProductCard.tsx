/**
 * Картка товару в списку.
 *
 * Показує рівно те, що вирішив сервер: price уже з урахуванням акції, а
 * basePrice приходить лише тоді, коли є що закреслити. Застосунок не рахує
 * знижки сам — інакше він і сайт неминуче розійшлися б у цифрах.
 *
 * Опису тут немає навмисно. Два рядки обрізаного тексту з 1С («Акумуляторний
 * тример призначений для косіння трави та догляду за…») не допомагають обрати
 * між двома тримерами — вони лише відсувають ціну й кнопку вниз. Опис читають
 * уже на сторінці товару, коли вибір звузився.
 */

import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
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
  const inStock = product.stock > 0;

  /**
   * Знімок не завантажився.
   *
   * image — довільний https-адрес, і частина посилань веде на сайти
   * постачальників: sigma.ua закриває гарячі посилання. Заглушка «немає фото»
   * виглядає як свідоме рішення, а не як зламаний застосунок.
   */
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(product.image) && !imgFailed;

  /**
   * Розмір знижки у відсотках — саме те число, яке шукає око на вітрині.
   * Округлення вниз: «−26%» на 26,8% чесніше за «−27%», якого покупець при
   * перевірці не побачить.
   */
  const discount =
    product.basePrice && product.basePrice > product.price
      ? Math.floor(((product.basePrice - product.price) / product.basePrice) * 100)
      : 0;

  return (
    <Link href={{ pathname: "/product/[slug]", params: { slug: product.slug } }} asChild>
      <Pressable style={styles.card}>
        <View>
          {showImage ? (
            <Image
              source={product.image}
              style={styles.image}
              // Зчитувач екрана інакше промовляє «зображення» без жодного змісту.
              alt={product.name}
              accessibilityLabel={product.name}
              contentFit="contain"
              onError={() => setImgFailed(true)}
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

          {/* Відсоток знижки читається швидше за слово «Акція»: він одразу
              відповідає на питання «наскільки дешевше». */}
          {discount > 0 && inStock ? (
            <View style={styles.discountBadge}>
              <Text style={styles.discountText}>−{discount}%</Text>
            </View>
          ) : null}
        </View>

        {product.label ? (
          <Text style={styles.label} numberOfLines={1}>
            {product.label}
          </Text>
        ) : null}

        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>

        {/* Наявність над ціною: покупець вирішує, чи взагалі варто читати
            ціну. Раніше «немає в наявності» стояло на місці кнопки — тобто про
            це дізнавались останнім, уже прицілившись купити. */}
        <View style={styles.stockRow}>
          <View style={[styles.dot, { backgroundColor: inStock ? colors.ok : colors.textMuted }]} />
          <Text style={[styles.stockText, { color: inStock ? colors.ok : colors.textMuted }]}>
            {inStock
              ? product.stock <= 5
                ? `Залишилось ${product.stock} шт.`
                : "В наявності"
              : "Немає в наявності"}
          </Text>
        </View>

        {/* Стара ціна над новою, а не поруч: поруч вони зливались в один
            довгий рядок дрібних цифр. */}
        {product.basePrice ? (
          <Text style={styles.priceBase}>{formatUAH(product.basePrice)}</Text>
        ) : null}
        <Text style={[styles.price, product.basePrice ? styles.priceSale : null]}>
          {formatUAH(product.price)}
        </Text>

        {pack ? <Text style={styles.pack}>Кратно {pack} шт</Text> : null}

        {onAdd && inStock ? (
          <Pressable
            style={styles.button}
            accessibilityRole="button"
            accessibilityLabel={`Додати «${product.name}» у кошик`}
            onPress={(e) => {
              // Кнопка живе всередині картки-посилання: без цього натиск
              // одночасно кладе товар у кошик і відкриває картку.
              e.stopPropagation();
              onAdd(product);
            }}
          >
            <Text style={styles.buttonText}>У кошик</Text>
          </Pressable>
        ) : onAdd ? (
          <View style={[styles.button, styles.buttonOff]}>
            <Text style={styles.buttonOffText}>Немає в наявності</Text>
          </View>
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
  discountBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.sale,
  },
  discountText: { fontSize: 11, fontWeight: "800", color: "#FFFFFF" },
  label: { marginTop: space.sm, fontSize: 11, color: colors.textMuted, textTransform: "uppercase" },
  /** Дві сталі рядки: без стелі картки в ряду виходять різновисокими. */
  name: { marginTop: space.xs, minHeight: 34, fontSize: 13, lineHeight: 17, color: colors.text },
  stockRow: { marginTop: space.sm, flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stockText: { fontSize: 11, fontWeight: "500" },
  priceBase: { marginTop: 4, fontSize: 12, color: colors.textMuted, textDecorationLine: "line-through" },
  price: { marginTop: 2, fontSize: 19, fontWeight: "800", color: colors.text },
  priceSale: { color: colors.sale },
  pack: { marginTop: 2, fontSize: 11, color: colors.textMuted },
  button: {
    marginTop: space.sm,
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  buttonText: { fontWeight: "700", color: colors.ink, fontSize: 13 },
  buttonOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonOffText: { fontWeight: "500", color: colors.textMuted, fontSize: 12 },
});
