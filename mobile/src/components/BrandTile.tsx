/**
 * Знак бренда: справжній логотип або плитка з назвою.
 *
 * Логотипів у нас п'ять на 359 брендів, і це не тимчасова прогалина — решта
 * це чужі торгові марки, які не можна «намалювати схожими»: приблизний
 * логотип виглядає як помилка, а не як бренд.
 *
 * Тому там, де логотипа немає, малюємо плитку з назвою на кольорі бренда.
 * Формально колір у базі є в усіх 359 — але в 352 із них він однаковий сірий
 * за замовчуванням, тобто його немає; для таких колір виводиться з назви (див.
 * colorFor). Це не заглушка «поки не зробили»: така плитка читається краще за
 * розтягнутий SVG із написом Arial, який лежить у public/brands.
 */

import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { colors, radius } from "@/theme";

export type BrandLike = {
  name: string;
  color?: string | null;
  logoUrl?: string | null;
};

/**
 * Сірий за замовчуванням, який стоїть у 352 брендів із 359.
 *
 * Формально колір є в усіх, але в переважної більшості він однаковий —
 * тобто його немає. Плитки вийшли б стіною сірого, а це гірше за відсутність
 * плиток: однакові знаки не розрізняють бренди, вони їх зливають.
 */
const DEFAULT_GREY = "#9e9e9e";

/**
 * Палітра для брендів без власного кольору.
 *
 * Глибокі приглушені тони, а не веселка: знак має виглядати як фірмовий колір,
 * а не як випадкова мітка. Кожен читається і з білим написом, і з чорним —
 * inkFor нижче обирає, з яким саме.
 */
const PALETTE = [
  "#1F3A93", "#B03A2E", "#1E824C", "#6C3483", "#B9770E",
  "#17657D", "#7D3C98", "#935116", "#1A5276", "#7B241C",
];

/**
 * Колір за назвою — стабільно й без збігів «через раз».
 *
 * Хеш, а не випадковість: бренд мусить мати той самий колір на головній, у
 * каталозі й у фільтрі, інакше знак перестає бути знаком.
 */
export function colorFor(brand: BrandLike): string {
  const own = brand.color?.toLowerCase();
  if (own && /^#[0-9a-f]{6}$/.test(own) && own !== DEFAULT_GREY) return own;

  let hash = 0;
  for (let i = 0; i < brand.name.length; i++) {
    hash = (hash * 31 + brand.name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/**
 * Чорний напис чи білий — за яскравістю тла.
 *
 * Формула сприйнятої яскравості (не середнє арифметичне): око значно
 * чутливіше до зеленого, ніж до синього, тож на #008300 білий напис читається,
 * а на #FFD600 — ні. Без цього половина плиток була б нечитабельна саме на
 * найпомітніших брендах.
 */
export function inkFor(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "#FFFFFF";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? colors.ink : "#FFFFFF";
}

export function BrandTile({
  brand,
  size = 44,
  style,
}: {
  brand: BrandLike;
  /** Висота знака. Ширина — вдвічі більша: логотипи майже завжди горизонтальні. */
  size?: number;
  style?: ViewStyle;
}) {
  const width = size * 2;

  if (brand.logoUrl) {
    return (
      <View style={[styles.logoWrap, { width, height: size }, style]}>
        <Image
          source={brand.logoUrl}
          style={{ width: width - 8, height: size - 8 }}
          contentFit="contain"
          alt={brand.name}
          accessibilityLabel={brand.name}
          cachePolicy="memory-disk"
          transition={120}
        />
      </View>
    );
  }

  const bg = colorFor(brand);
  const ink = inkFor(bg);
  const label = brand.name.toUpperCase();

  /**
   * Кегль рахуємо самі, а не покладаємось на adjustsFontSizeToFit: він працює
   * лише на iOS і Android, а у веб-збірці (нею ж дивимось верстку) мовчки
   * ігнорується — і «DNIPRO-M» лишається «DNIP...». Формула груба, але
   * передбачувана: жирна велика літера займає близько 0,75 кегля завширшки.
   * Коефіцієнт підібрано за найдовшими назвами каталогу — DNIPRO-M, БРИГАДИР
   * і STREND PRO; із запасом 0,62 вони ще обрізались.
   */
  const available = width - 12;
  const fontSize = Math.max(8, Math.min(16, Math.floor(available / (label.length * 0.75))));

  /** На дрібному кеглі розрядка з'їдає рівно ту ширину, якої бракує. */
  const letterSpacing = fontSize >= 13 ? 0.3 : 0;

  return (
    <View
      style={[styles.tile, { width, height: size, backgroundColor: bg }, style]}
      accessibilityLabel={brand.name}
    >
      {/*
        Напис підганяється під ширину, а не обрізається. «DNIPRO-M» із трьома
        крапками читається як помилка даних, тоді як той самий напис на два
        кегля менше лишається назвою бренда.
      */}
      <Text style={[styles.tileText, { color: ink, fontSize, letterSpacing }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    // Біле тло під логотипом: більшість із них намальовані для світлого фону,
    // і на сірій картці темні контури зливаються.
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.border,
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: 6,
  },
  tileText: { fontWeight: "800", textAlign: "center" },
});
