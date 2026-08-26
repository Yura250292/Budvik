/**
 * Знак у шапці застосунку.
 *
 * Шапка казала просто «Головна» — на знімку екрана неможливо було зрозуміти,
 * чий це застосунок узагалі. Логотип у шапці — це не прикраса: він відповідає
 * на питання «де я» щоразу, коли людина повертається до застосунку через
 * тиждень і бачить його серед двох десятків інших.
 *
 * Повторює знак сайту: жовтий квадрат із «27» і назва поруч. Підзаголовка
 * «Ваш світ інструментів» тут немає — у 44 px шапки він або нечитабельний,
 * або розпирає її вдвічі.
 */

import { View, Text, StyleSheet } from "react-native";
import { colors, radius } from "@/theme";

export function BrandHeader() {
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="БУДВІК27">
      <View style={styles.badge}>
        <Text style={styles.badgeText}>27</Text>
      </View>
      <Text style={styles.name}>
        БУДВ<Text style={styles.nameAccent}>ІК27</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 13, fontWeight: "900", color: colors.ink },
  name: { fontSize: 18, fontWeight: "800", letterSpacing: 0.5, color: "#FFFFFF" },
  nameAccent: { color: colors.brand },
});
