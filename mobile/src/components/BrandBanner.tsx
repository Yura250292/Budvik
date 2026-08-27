/**
 * Банер бренда — той самий, що на головній сайту, лише менший.
 *
 * До цього бренди в застосунку були рядком дрібних знаків і списком рядків:
 * швидкий вхід для того, хто вже знає, чий інструмент бере, але про сам бренд
 * не сказано нічого. Банер показує фірмову пару кольорів, чим бренд є, скільки
 * в нього товару в наявності і як той товар виглядає.
 *
 * Спершу пара кольорів була двома площинами: суцільна заливка й прямокутник
 * другого тону праворуч. Це читалося як два зшиті аркуші, а не як банер —
 * фірмовий колір мусить перетікати. Тепер тут справжній градієнт по діагоналі
 * (expo-linear-gradient є в Expo Go, нової збірки не потребує) і відблиск у
 * лівому верхньому куті, як на сайті.
 *
 * Знімки стоять у білих плитках «віялом», а не врізані в тло: фото каталогів
 * зняті на білому й без прозорості, а blend-режимів у React Native немає — на
 * кольоровому банері з них стирчали б білі прямокутники.
 *
 * Компонент один на два місця: рейку на головній і список брендів у каталозі.
 * Різниця лише в ширині — вигляд бренда мусить бути однаковий скрізь, інакше
 * знак перестає бути знаком.
 */

import { View, Text, Pressable, StyleSheet, type DimensionValue } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
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
   * Другий фірмовий колір — у правий нижній кут, під знімки. Старіші збірки
   * сервера його не шлють, тоді банер лишається однотонним.
   */
  accentTo?: string | null;
  /** Колір назви, коли логотипа немає. Немає — беремо за контрастом. */
  wordmark?: string | null;
  logoUrl?: string | null;
  count: number;
  photos: string[];
};

/** Нахил плиток у віялі. Три знімки — три кути, як на сайті. */
const FAN_ANGLES = ["-7deg", "2deg", "9deg"];

export function BrandBanner({
  brand: b,
  width,
  onPress,
}: {
  brand: ShowcaseBrand;
  width: DimensionValue;
  onPress: () => void;
}) {
  const ink = inkFor(b.accent);
  const light = ink !== "#FFFFFF";
  const photos = b.photos.slice(0, 3);

  return (
    <Pressable
      style={[styles.card, { width, backgroundColor: b.accent }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${b.name}. ${b.tagline}. ${formatPositions(b.count)}`}
    >
      {b.accentTo ? (
        <LinearGradient
          colors={[b.accent, b.accent, b.accentTo]}
          locations={[0, 0.22, 0.92]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {/* Відблиск: світлий на темних банерах, темний на світлих. Біле по білому
          (APRO) не видно, а чорне по чорному (СИЛА, POLAX) з'їдало б кут. */}
      <LinearGradient
        colors={light ? ["rgba(255,255,255,0.55)", "rgba(255,255,255,0)"] : ["rgba(255,255,255,0.20)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.75, y: 0.85 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.body}>
        {b.logoUrl ? (
          // Біле тло під логотипом: майже всі вони намальовані для світлого
          // фону, і на фірмовому кольорі контури зливаються.
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
          // Логотипа немає — пишемо назву. «Схожий» логотип малювати не можна:
          // це чужа торгова марка.
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

      {/* Віяло знімків. Кожна наступна плитка трохи вище й повернута в інший
          бік — стос карток, а не одна картинка збоку. */}
      {photos.map((src, i) => (
        <View
          key={src}
          style={[
            styles.tile,
            {
              right: 10 + i * 22,
              bottom: 14 + i * 10,
              transform: [{ rotate: FAN_ANGLES[i] ?? "0deg" }],
              zIndex: photos.length - i,
            },
          ]}
        >
          <Image
            source={src}
            style={styles.tileImage}
            alt=""
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={150}
          />
        </View>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space.lg,
    borderRadius: radius.lg,
    minHeight: 150,
    justifyContent: "center",
    overflow: "hidden",
  },
  /** Текст займає ліві дві третини: праворуч лежить віяло. */
  body: { gap: space.xs, width: "62%" },
  logoWrap: {
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  logo: { width: 92, height: 26 },
  wordmark: { fontSize: 22, fontWeight: "900", letterSpacing: 0.3 },
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
  tile: {
    position: "absolute",
    width: 86,
    height: 86,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
    // Тінь відділяє плитку від тла й від сусідніх плиток у стосі.
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  tileImage: { width: "100%", height: "100%" },
});
