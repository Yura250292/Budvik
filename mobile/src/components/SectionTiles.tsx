/**
 * Плитки розділів каталогу з фотографією справжнього товару.
 *
 * Головна досі вела або в пошук, або до брендів — тобто відповідала на
 * питання «чий інструмент», хоча покупець приходить із питанням «мені
 * потрібна болгарка». Розділи були лише на окремій вкладці «Каталог», тобто
 * за одне зайве натискання від головної.
 *
 * Фото, а не emoji: 🎨 однаково позначає фарбу, дизайн і свято, тож око все
 * одно шукає підпис. Знімок болгарки під написом «Електроінструмент» дає
 * відповідь швидше, ніж встигаєш прочитати.
 */

import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, space, radius, formatPositions } from "@/theme";

export type SectionTile = {
  id: string;
  title: string;
  total: number;
  types: string[];
  image?: string | null;
};

export function SectionTiles({ sections }: { sections: SectionTile[] }) {
  const router = useRouter();
  if (sections.length === 0) return null;

  return (
    <View style={styles.grid}>
      {sections.map((s) => (
        <Tile
          key={s.id}
          section={s}
          onPress={() =>
            router.push({
              pathname: "/list",
              params: { type: s.types.join(","), title: s.title },
            })
          }
        />
      ))}
    </View>
  );
}

function Tile({ section, onPress }: { section: SectionTile; onPress: () => void }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(section.image) && !failed;

  return (
    <Pressable
      style={styles.tile}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${section.title}, ${formatPositions(section.total)}`}
    >
      <View style={styles.thumbWrap}>
        {showImage ? (
          <Image
            source={section.image}
            style={styles.thumb}
            /* Порожній alt: знімок тут ілюструє підпис, а не додає змісту —
               зчитувач екрана має прочитати назву розділу, а не «зображення». */
            alt=""
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={120}
            onError={() => setFailed(true)}
          />
        ) : (
          <Ionicons name="albums-outline" size={22} color={colors.textMuted} />
        )}
      </View>
      {/* Два рядки з фіксованою висотою: назви розділів різної довжини, і без
          стелі плитки в сітці виходять різновисокими. */}
      <Text style={styles.title} numberOfLines={2}>
        {section.title}
      </Text>
      <Text style={styles.count}>{formatPositions(section.total)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: space.sm,
    gap: space.sm,
  },
  tile: {
    /* Три в ряд: чотири дають надто дрібне фото, два — надто мало розділів
       на екран, і список знову доводиться гортати. */
    width: "31%",
    flexGrow: 1,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  thumbWrap: {
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    /* Біле, а не сіре. Знімки товарів зняті на білому тлі й без прозорості,
       тож сіра підкладка перетворювалась на сіру рамку навколо білого
       прямокутника — рамка в рамці. На білому фото зливається з карткою і
       видно сам інструмент, а не коробку, в якій він лежить. */
    backgroundColor: colors.bg,
  },
  thumb: { width: "100%", height: "100%" },
  title: { marginTop: space.xs, minHeight: 30, fontSize: 11, lineHeight: 15, fontWeight: "600", color: colors.text },
  count: { fontSize: 10, color: colors.textMuted },
});
