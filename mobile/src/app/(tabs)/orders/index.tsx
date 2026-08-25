/**
 * Історія замовлень.
 *
 * Статуси й підписи ті самі, що в кабінеті на сайті: людина, яка бачила
 * «На упакуванні» в браузері, має побачити те саме слово тут, а не власний
 * переклад застосунку.
 */

import { View, Text, FlatList, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, type OrderSummary } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { RowSkeleton } from "@/components/Skeleton";
import { colors, space, radius, formatUAH } from "@/theme";

/** Дзеркало ORDER_STATUS_LABELS із src/lib/utils.ts на сайті. */
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Нове",
  PAID: "Підтверджено",
  PACKAGING: "На упакуванні",
  IN_TRANSIT: "В дорозі",
  DELIVERED: "Доставлено",
  CANCELLED: "Скасовано",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: colors.textMuted,
  PAID: colors.ok,
  PACKAGING: colors.ok,
  IN_TRANSIT: colors.ok,
  DELIVERED: colors.ok,
  CANCELLED: colors.sale,
};

export default function OrdersScreen() {
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ["orders"],
    queryFn: api.orders,
  });

  if (isLoading) {
    return (
      <View style={{ padding: space.md }}>
        {[0, 1, 2].map((i) => (
          <RowSkeleton key={i} />
        ))}
      </View>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon="receipt-outline"
        title="Історія замовлень в акаунті"
        hint="Увійдіть, щоб бачити статус доставки й повторювати замовлення одним дотиком."
        actionLabel="Увійти"
        onAction={() => router.push("/account")}
      />
    );
  }

  if (!data || data.orders.length === 0) {
    return (
      <EmptyState
        icon="receipt-outline"
        title="Замовлень ще немає"
        hint="Після першого замовлення тут буде його статус — від «Нове» до «Доставлено»."
        actionLabel="До каталогу"
        onAction={() => router.push("/catalog")}
      />
    );
  }

  return (
    <FlatList
      data={data.orders}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ padding: space.md }}
      renderItem={({ item }) => <OrderRow order={item} />}
    />
  );
}

function OrderRow({ order }: { order: OrderSummary }) {
  const date = new Date(order.createdAt).toLocaleDateString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.number}>№ {order.orderNumber}</Text>
        <Text style={[styles.status, { color: STATUS_COLORS[order.status] ?? colors.textMuted }]}>
          {STATUS_LABELS[order.status] ?? order.status}
        </Text>
      </View>
      <Text style={styles.date}>{date}</Text>

      {order.items.slice(0, 3).map((i, idx) => (
        <Text key={idx} style={styles.item} numberOfLines={1}>
          {i.quantity} × {i.product.name}
        </Text>
      ))}
      {order.items.length > 3 ? (
        <Text style={styles.more}>і ще {order.items.length - 3}</Text>
      ) : null}

      <View style={styles.foot}>
        <Text style={styles.total}>{formatUAH(order.totalAmount)}</Text>
        {order.boltsEarned > 0 ? (
          <Text style={styles.bolts}>+{order.boltsEarned} Болтів</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  hint: { padding: space.lg, color: colors.textMuted, textAlign: "center" },
  card: {
    padding: space.md,
    marginBottom: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  number: { fontSize: 15, fontWeight: "700", color: colors.text },
  status: { fontSize: 13, fontWeight: "600" },
  date: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  item: { marginTop: space.xs, fontSize: 13, color: colors.text },
  more: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  foot: { marginTop: space.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  total: { fontSize: 17, fontWeight: "800", color: colors.text },
  bolts: { fontSize: 12, color: colors.ok, fontWeight: "600" },
  button: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  buttonText: { fontWeight: "700", color: colors.ink },
});
