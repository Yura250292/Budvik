/**
 * Банери брендів — та сама вітрина, що на головній сайту.
 *
 * До цього бренди в застосунку були рядком дрібних знаків: швидкий вхід для
 * того, хто вже знає, чий інструмент бере, але нічого не розповідає про сам
 * бренд. Банер показує фірмовий колір, чим бренд є, скільки в нього товару в
 * наявності і як той товар виглядає.
 *
 * Знімок стоїть у білій плитці, а не врізаний у тло: фото каталогів зняті на
 * білому й без прозорості, а blend-режимів у React Native немає — на
 * кольоровому банері з нього стирчав би білий прямокутник. Та сама плитка, що
 * в банерах вище (bannerThumb), тож екран лишається одним цілим.
 */

import { ScrollView, View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { inkFor } from "@/components/BrandTile";
import { colors, space, radius, formatPositions } from "@/theme";

export type ShowcaseBrand = {
  slug: string;
  name: string;
  tagline: string;
  /** Фірмовий колір під написом. */
  accent: string;
  /**
   * Другий фірмовий колір — під знімком. Старіші збірки сервера його не
   * шлють, тоді картка лишається однотонною.
   */
  accentTo?: string | null;
  /** Колір назви, коли логотипа немає. Немає — беремо за контрастом. */
  wordmark?: string | null;
  logoUrl?: string | null;
  count: number;
  photos: string[];
};

export function BrandBannerRail({
  brands,
  onOpen,
}: {
  brands: ShowcaseBrand[];
  onOpen: (brand: ShowcaseBrand) => void;
}) {
  /* Картка трохи вужча за екран: край наступної видно, і стає зрозуміло, що
     стрічку можна гортати. Стеля в 320 px — щоб на планшеті банер не
     розтягнувся на пів екрана. */
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(320, width - space.md * 3);

  if (brands.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + space.md}
      snapToAlignment="start"
      decelerationRate="fast"
      contentContainerStyle={styles.row}
    >
      {brands.map((b) => {
        const ink = inkFor(b.accent);
        const photo = b.photos[0];

        return (
          <Pressable
            key={b.slug}
            style={[styles.card, { width: cardWidth, backgroundColor: b.accent }]}
            onPress={() => onOpen(b)}
            accessibilityRole="button"
            accessibilityLabel={`${b.name}. ${b.tagline}. ${formatPositions(b.count)}`}
          >
            {/*
              Друга фірмова барва — смугою праворуч, під знімком.

              У React Native немає градієнтів без окремого пакета, тож пара
              кольорів бренда (у POLAX помаранч-чорний, у СИЛИ жовтий-чорний)
              показана площинами: напис лежить на першій, знімок — на другій.
              Виглядає як фірмовий блок, а не як залитий прямокутник, і не
              тягне в застосунок нову залежність.
            */}
            {b.accentTo ? (
              <View style={[styles.accentPanel, { backgroundColor: b.accentTo }]} />
            ) : null}

            <View style={styles.body}>
              {b.logoUrl ? (
                // Біле тло під логотипом: майже всі вони намальовані для
                // світлого фону, і на фірмовому кольорі контури зливаються.
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
                // Логотипа немає — пишемо назву. «Схожий» логотип малювати не
                // можна: це чужа торгова марка.
                <Text style={[styles.wordmark, { color: b.wordmark ?? ink }]} numberOfLines={1}>
                  {b.name.toUpperCase()}
                </Text>
              )}

              <Text style={[styles.tagline, { color: ink }]} numberOfLines={2}>
                {b.tagline}
              </Text>

              <View style={styles.countPill}>
                <Text style={styles.countText}>{formatPositions(b.count)}</Text>
                <Ionicons name="arrow-forward" size={12} color={colors.ink} />
              </View>
            </View>

            {photo ? (
              <View style={styles.thumb}>
                <Image
                  source={photo}
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
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: space.md, gap: space.md, paddingBottom: space.md },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    minHeight: 140,
    overflow: "hidden",
  },
  /** Смуга другого кольору: права третина картки, під знімком. */
  accentPanel: { position: "absolute", right: 0, top: 0, bottom: 0, width: "38%" },
  body: { flex: 1, gap: space.xs },
  logoWrap: {
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  logo: { width: 92, height: 26 },
  wordmark: { fontSize: 20, fontWeight: "900", letterSpacing: 0.3 },
  tagline: { fontSize: 12, lineHeight: 16, opacity: 0.85 },
  countPill: {
    marginTop: space.xs,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  countText: { fontSize: 11, fontWeight: "800", color: colors.ink },
  thumb: {
    width: 86,
    height: 86,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  thumbImage: { width: "100%", height: "100%" },
});
