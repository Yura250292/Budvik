/**
 * Стрічка банерів брендів на головній.
 *
 * Сама картка живе в BrandBanner — вона ж стоїть у списку брендів каталогу.
 * Тут лише гортання: бренд мусить виглядати однаково на обох екранах.
 */

import { ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { BrandBanner, type ShowcaseBrand } from "@/components/BrandBanner";
import { space } from "@/theme";

export type { ShowcaseBrand } from "@/components/BrandBanner";

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
      {brands.map((b) => (
        <BrandBanner key={b.slug} brand={b} width={cardWidth} onPress={() => onOpen(b)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: space.md, gap: space.md, paddingBottom: space.md },
});
