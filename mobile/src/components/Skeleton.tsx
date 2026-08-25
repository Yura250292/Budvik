/**
 * Заглушки на час завантаження.
 *
 * Не спінер посеред порожнього екрана, а сама форма того, що зараз приїде.
 * Різниця не косметична: спінер нічого не займає, тож коли дані приходять,
 * висота стрибає й людина промахується повз картку, у яку цілилась. Заглушка
 * тримає місце заздалегідь — екран не смикається.
 *
 * Розміри тут мусять збігатися з ProductCard. Якщо картка змінить висоту
 * фото чи кількість рядків назви, це треба повторити й тут — інакше стрибок
 * повернеться, просто менший.
 */

import { useEffect, useState } from "react";
import { View, Animated, StyleSheet, AccessibilityInfo, type ViewStyle } from "react-native";
import { colors, space, radius } from "@/theme";

/**
 * Один прямокутник, що дихає.
 *
 * Вбудована Animated, а не reanimated: для пульсації прозорості різниці в
 * плавності немає (обидві йдуть нативним драйвером), зате React Compiler не
 * дозволяє міняти значення, повернуте хуком, — а саме так влаштовані спільні
 * значення reanimated. Сперечатися з правилом заради ефекту, який і так
 * робиться одним рядком, не варто.
 */
export function SkeletonBlock({ style }: { style?: ViewStyle }) {
  /**
   * Лінивий ініціалізатор стану, а не useRef().current: звертатися до
   * .current під час рендеру не можна — React не гарантує, що компонент
   * оновиться. Значення створюється один раз і не змінюється, тож стан тут
   * поводиться як стабільне посилання.
   */
  const [opacity] = useState(() => new Animated.Value(0.5));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduceMotion(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // Пульсація вимкнена системно — лишаємо статичну плитку, а не миготіння.
      opacity.setValue(0.6);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, opacity]);

  return <Animated.View style={[styles.block, style, { opacity }]} />;
}

/** Заглушка картки товару — тих самих розмірів, що й сама картка. */
export function ProductCardSkeleton() {
  return (
    <View style={styles.card}>
      <SkeletonBlock style={styles.image} />
      <SkeletonBlock style={styles.label} />
      <SkeletonBlock style={styles.line} />
      <SkeletonBlock style={styles.lineShort} />
      <SkeletonBlock style={styles.price} />
      <SkeletonBlock style={styles.button} />
    </View>
  );
}

/**
 * Сітка заглушок замість списку.
 *
 * Шість штук — рівно стільки, скільки видно на екрані телефона: більше
 * означало б малювати анімацію там, куди ніхто не дивиться.
 */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.grid} accessibilityLabel="Завантаження товарів">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.cell}>
          <ProductCardSkeleton />
        </View>
      ))}
    </View>
  );
}

/** Заглушка рядка списку — для замовлень і брендів. */
export function RowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock style={styles.line} />
      <SkeletonBlock style={styles.lineShort} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.border, borderRadius: radius.sm },

  grid: { flexDirection: "row", flexWrap: "wrap", padding: space.xs },
  cell: { width: "50%" },

  card: {
    margin: space.xs,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: "100%", height: 120 },
  label: { width: "40%", height: 9, marginTop: space.sm },
  line: { width: "100%", height: 12, marginTop: space.xs },
  lineShort: { width: "65%", height: 12, marginTop: space.xs },
  price: { width: "50%", height: 18, marginTop: space.sm },
  button: { width: "100%", height: 34, marginTop: space.sm, borderRadius: radius.sm },

  row: {
    padding: space.md,
    marginBottom: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
