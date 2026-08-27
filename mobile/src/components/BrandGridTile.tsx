/**
 * Компактна картка бренда — той самий банер, зменшений до половини екрана.
 *
 * Список брендів був таблицею: три сотні однакових рядків, у кожному дрібний
 * знак, назва й число. Бренди в такому списку відрізняються лише написом, і
 * його доводиться читати щоразу.
 *
 * Тут те саме, що на великому банері: фірмовий колір із переходом, відблиск у
 * куті, назва й знімок товару в білій плитці. Різниця лише в тому, що знімок
 * один — на 118 пікселях висоти віяло з трьох перетворилося б на кашу.
 *
 * Другий тон у більшості брендів свій не заведений (він є у восьми з вітрини),
 * тож для решти рахуємо його з першого — притемненням. Це гірше за справжню
 * фірмову пару, але помітно краще за суцільну заливку.
 */

import { View, Text, Pressable, StyleSheet, type DimensionValue } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { inkFor, colorFor, type BrandLike } from "@/components/BrandTile";
import { colors, space, radius, formatPositions } from "@/theme";

export type GridBrand = BrandLike & {
  slug: string;
  count: number;
  /** Знімок товару бренда. Є менш ніж у кожного восьмого — решта лишається кольором. */
  photo?: string | null;
  /** Три найбільші групи товару: «свердла, хомути, круги». */
  summary?: string | null;
};

/** Той самий колір, притемнений: другий тон градієнта, коли свого немає. */
function shade(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const mix = (from: number, to: number) => Math.max(0, Math.round(parseInt(hex.slice(from, to), 16) * 0.66));
  return `#${[mix(1, 3), mix(3, 5), mix(5, 7)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

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
  const light = ink !== "#FFFFFF";

  return (
    <Pressable
      style={[styles.card, { width, backgroundColor: bg }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${b.name}, ${formatPositions(b.count)}`}
    >
      <LinearGradient
        colors={[bg, bg, shade(bg)]}
        locations={[0, 0.25, 0.95]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={light ? ["rgba(255,255,255,0.5)", "rgba(255,255,255,0)"] : ["rgba(255,255,255,0.18)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />

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
          <Text style={[styles.wordmark, { color: ink }]} numberOfLines={1}>
            {b.name.toUpperCase()}
          </Text>
        )}

        {/* Рядок «що всередині» — той самий прийом, що на банерах розділів
            сайту: назва бренда сама по собі не каже, що там лежить. */}
        {b.summary ? (
          <Text style={[styles.summary, { color: ink }]} numberOfLines={2}>
            {b.summary}
          </Text>
        ) : null}
      </View>

      <View style={styles.countPill}>
        <Text style={styles.countText}>{formatPositions(b.count)}</Text>
      </View>

      {b.photo ? (
        <View style={styles.tile}>
          <Image
            source={b.photo}
            style={styles.tileImage}
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
    minHeight: 148,
    padding: space.md,
    borderRadius: radius.md,
    overflow: "hidden",
    justifyContent: "space-between",
  },
  /* Текст тримається лівої частини: правий нижній кут займає знімок. */
  body: { gap: 3, paddingRight: 8 },
  summary: { fontSize: 10, lineHeight: 13, opacity: 0.8 },
  logoWrap: {
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  logo: { width: 74, height: 20 },
  wordmark: { fontSize: 15, fontWeight: "900", letterSpacing: 0.2 },
  countPill: {
    alignSelf: "flex-start",
    marginTop: space.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  countText: { fontSize: 10, fontWeight: "800", color: colors.ink },
  /* Знімок у білій плитці — та сама, що на банерах: у RN немає blend-режимів,
     а фото каталогів зняті на білому без прозорості. */
  tile: {
    position: "absolute",
    right: space.sm,
    bottom: space.sm,
    width: 62,
    height: 62,
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    padding: 5,
    transform: [{ rotate: "-4deg" }],
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  tileImage: { width: "100%", height: "100%" },
});
