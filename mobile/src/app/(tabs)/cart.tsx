/**
 * Кошик.
 *
 * Підсумок тут довідковий: остаточну суму рахує сервер при оформленні. Ціни
 * їдуть з 1С кожні кілька хвилин, і показувати збережений знімок як остаточну
 * суму означало б обіцяти те, чого можемо не виконати.
 */

import { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { getCart, updateQty, cartTotal, type CartItem } from "@/lib/cart";
import { EmptyState } from "@/components/EmptyState";
import { colors, space, radius, formatUAH } from "@/theme";

export default function CartScreen() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);

  // Кошик змінюють інші екрани, тож перечитуємо його щоразу при поверненні
  // сюди, а не один раз при монтуванні.
  useFocusEffect(
    useCallback(() => {
      getCart().then(setCart);
    }, [])
  );

  async function change(item: CartItem, delta: number) {
    // Крок — одна пачка: для товару «кратно 10» кнопка «+» має додавати 10,
    // інакше сервер усе одно округлить угору, і кількість стрибне сама.
    const step = item.packQty && item.packQty > 1 ? item.packQty : 1;
    setCart(await updateQty(item.productId, item.quantity + delta * step));
  }

  if (cart.length === 0) {
    return (
      <EmptyState
        icon="cart-outline"
        title="Кошик порожній"
        hint="Знайдіть інструмент у каталозі або відскануйте код із цінника — і він з'явиться тут."
        actionLabel="До каталогу"
        onAction={() => router.push("/catalog")}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={cart}
        keyExtractor={(i) => i.productId}
        contentContainerStyle={{ padding: space.md }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            {item.image ? (
              <Image
                source={item.image}
                style={styles.thumb}
                alt={item.name}
                accessibilityLabel={item.name}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.thumb, styles.noPhoto]}>
                <Ionicons name="image-outline" size={20} color={colors.textMuted} />
              </View>
            )}

            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={styles.unit}>{formatUAH(item.price)} / шт</Text>

              <View style={styles.qtyRow}>
                <Pressable
                  style={styles.qtyButton}
                  onPress={() => change(item, -1)}
                  accessibilityLabel="Зменшити кількість"
                >
                  <Ionicons name="remove" size={20} color={colors.ink} />
                </Pressable>
                <Text style={styles.qty}>{item.quantity}</Text>
                <Pressable
                  style={styles.qtyButton}
                  onPress={() => change(item, 1)}
                  accessibilityLabel="Збільшити кількість"
                >
                  <Ionicons name="add" size={20} color={colors.ink} />
                </Pressable>
                <Text style={styles.lineTotal}>{formatUAH(item.price * item.quantity)}</Text>
              </View>
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Разом</Text>
          <Text style={styles.totalValue}>{formatUAH(cartTotal(cart))}</Text>
        </View>
        <Text style={styles.note}>Остаточну суму підтвердимо при оформленні</Text>
        <Pressable style={styles.button} onPress={() => router.push("/checkout")}>
          <Text style={styles.buttonText}>Оформити замовлення</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  row: {
    flexDirection: "row",
    gap: space.md,
    padding: space.md,
    marginBottom: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surface },
  noPhoto: { alignItems: "center", justifyContent: "center" },
  name: { fontSize: 13, lineHeight: 17, color: colors.text },
  unit: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  qtyRow: { marginTop: space.sm, flexDirection: "row", alignItems: "center", gap: space.md },
  /**
   * 44×44 — мінімальна ціль дотику. Тридцять два пікселі виглядають
   * акуратніше, але в них не влучає великий палець у робочій рукавиці, а
   * саме так наш покупець і тримає телефон на об'єкті.
   */
  qtyButton: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  qty: { minWidth: 32, textAlign: "center", fontWeight: "700", color: colors.text },
  lineTotal: { marginLeft: "auto", fontWeight: "700", color: colors.text },
  footer: { padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  totalLabel: { fontSize: 15, color: colors.textMuted },
  totalValue: { fontSize: 22, fontWeight: "800", color: colors.text },
  note: { marginTop: 2, fontSize: 11, color: colors.textMuted },
  button: {
    marginTop: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  buttonText: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
