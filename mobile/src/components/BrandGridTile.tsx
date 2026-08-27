/**
 * Компактна картка бренда — для списку брендів у каталозі.
 *
 * Список був таблицею: три сотні однакових рядків, у кожному дрібний знак,
 * назва й число. Бренди в такому списку відрізняються тільки написом, і його
 * доводиться читати щоразу.
 *
 * Картка — той самий банер, тільки менший: фірмовий колір, назва, лічильник і
 * знімок товару. Другої барви тут немає навмисно — на 130 пікселях вона
 * перетворилася б на смужку, а не на фірмову пару.
 */

import { View, Text, Pressable, StyleSheet, type DimensionValue } from "react-native";
import { Image } from "expo-image";
import { inkFor, colorFor, type BrandLike } from "@/components/BrandTile";
import { colors, space, radius, formatPositions } from "@/theme";

export type GridBrand = BrandLike & {
  slug: string;
  count: number;
  /** Знімок товару бренда. Є менш ніж у кожного восьмого — решта лишається кольором. */
  photo?: string | null;
};

export function BrandGridTile({
  brand: b,
  width,
  onPress,
}: {
  brand: GridBrand;
  width: DimensionValue;
  onPress: () => void;
}) {
  const bg = colorFor(b);
  const ink = inkFor(bg);

  return (
    <Pressable
      style={[styles.card, { width, backgroundColor: bg }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${b.name}, ${formatPositions(b.count)}`}
    >
      <View style={styles.body}>
        {b.logoUrl ? (
          <View style={styles.logoWrap}>
            <Image
              source={b.logoUrl}
              style={styles.logo}
              contentFit="contain"
              alt={b.name}
              cachePolicy="memory-disk"
              transition={120}
            />
          </View>
        ) : (
          <Text style={[styles.wordmark, { color: ink }]} numberOfLines={2}>
            {b.name.toUpperCase()}
          </Text>
        )}

        <Text style={[styles.count, { color: ink }]}>{formatPositions(b.count)}</Text>
      </View>

      {b.photo ? (
        <View style={styles.thumb}>
          <Image
            source={b.photo}
            style={styles.thumbImage}
            alt=""
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={150}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 118,
    padding: space.md,
    borderRadius: radius.md,
    overflow: "hidden",
    justifyContent: "space-between",
  },
  body: { gap: space.xs, paddingRight: 52 },
  logoWrap: {
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  logo: { width: 74, height: 20 },
  wordmark: { fontSize: 15, fontWeight: "900", letterSpacing: 0.2 },
  count: { fontSize: 11, fontWeight: "700", opacity: 0.85 },
  /* Знімок у білій плитці — та сама, що на банерах: у RN немає blend-режимів,
     а фото каталогів зняті на білому без прозорості. */
  thumb: {
    position: "absolute",
    right: space.sm,
    bottom: space.sm,
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  thumbImage: { width: "100%", height: "100%" },
});
