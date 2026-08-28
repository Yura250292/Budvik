/**
 * Порожній стан: коли показувати нічого, але сказати є що.
 *
 * Один компонент на всі випадки навмисно. Порожній кошик, порожнє обране й
 * нульова видача пошуку — це три різні причини, але одна ситуація для людини:
 * екран порожній, і незрозуміло, це поломка чи так і має бути. Різні на вигляд
 * заглушки в кожному місці читаються як різні поломки.
 *
 * Обов'язкові тут — рядок пояснення й дія. Самого «Нічого не знайдено» замало:
 * воно каже, що сталося, і мовчить про те, що робити далі.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, space, radius } from "@/theme";

export function EmptyState({
  icon,
  title,
  hint,
  actionLabel,
  onAction,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={34} color={colors.textMuted} />
      </View>

      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {actionLabel && onAction ? (
        <Pressable style={styles.button} onPress={onAction} accessibilityRole="button">
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * Вертикально трохи вище центру: рівно посередині напис опиняється під
   * великим пальцем, яким людина щойно гортала, і його не видно.
   */
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xl,
    paddingBottom: space.xl * 2,
    gap: space.md,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    textAlign: "center",
    // Довший рядок на телефоні читається гірше — тримаємо колонку вузькою.
    maxWidth: 280,
  },
  button: {
    marginTop: space.sm,
    // 44 по висоті — мінімальна ціль дотику; по горизонталі з запасом, щоб
    // напис не торкався країв.
    minHeight: 44,
    paddingHorizontal: space.xl,
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  buttonText: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
