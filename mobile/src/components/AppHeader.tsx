/**
 * Шапка застосунку.
 *
 * Було дві смуги одна під одною: чорна з логотипом, яку малює навігатор, і під
 * нею рядок пошуку в тілі екрана. Разом вони з'їдали чверть екрана й не робили
 * майже нічого — логотип не натискається, а пошук доводилось шукати очима
 * серед банерів. Тепер це один блок: знак, швидкі дії і поле пошуку.
 *
 * Блок лишається на місці, коли сторінка гортається. Пошук — головна дія в
 * магазині інструменту, де 22 тисячі позицій: людина, яка згадала артикул на
 * третьому екрані прокрутки, не мусить вертатися нагору.
 *
 * Темний фон іде під статусний рядок: інакше під годинником лишалася б біла
 * смуга, і шапка виглядала б приклеєною. Висоту вирізу беремо в системи, а не
 * зашиваємо — у різних телефонів вона різна.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, space, radius } from "@/theme";

export function AppHeader({
  onSearch,
  onScan,
  onWishlist,
  cartCount = 0,
  onCart,
  showSearch = true,
}: {
  onSearch: () => void;
  onScan: () => void;
  onWishlist?: () => void;
  cartCount?: number;
  onCart?: () => void;
  /**
   * Поле пошуку. Ховається на екрані пошуку — там уже є справжнє поле з
   * клавіатурою, і кнопка, схожа на поле, поруч із ним виглядала б як помилка.
   */
  showSearch?: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space.sm }]}>
      {/* Легкий перехід замість суцільної чорноти: смуга перестає виглядати
          наліпкою й м'яко переходить у білу сторінку під нею. */}
      <LinearGradient
        colors={["#161616", colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.topRow}>
        <View style={styles.brand} accessibilityRole="header" accessibilityLabel="БУДВІК27">
          <View style={styles.badge}>
            <Text style={styles.badgeText}>27</Text>
          </View>
          <Text style={styles.name}>
            БУДВ<Text style={styles.nameAccent}>ІК27</Text>
          </Text>
        </View>

        <View style={styles.actions}>
          {onWishlist ? (
            <Pressable
              style={styles.iconButton}
              onPress={onWishlist}
              accessibilityRole="button"
              accessibilityLabel="Обране"
            >
              <Ionicons name="heart-outline" size={21} color="#FFFFFF" />
            </Pressable>
          ) : null}

          {onCart ? (
            <Pressable
              style={styles.iconButton}
              onPress={onCart}
              accessibilityRole="button"
              accessibilityLabel={cartCount > 0 ? `Кошик, ${cartCount}` : "Кошик"}
            >
              <Ionicons name="cart-outline" size={21} color="#FFFFFF" />
              {/* Лічильник тут дублює бейдж на вкладці навмисно: додавши товар
                  на картці, людина дивиться вгору, а не вниз. */}
              {cartCount > 0 ? (
                <View style={styles.badgeDot}>
                  <Text style={styles.badgeDotText}>{cartCount > 99 ? "99+" : cartCount}</Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      </View>

      {/*
        Не поле вводу, а кнопка, схожа на поле: клавіатура, що вискакує на
        головній, ховає половину вітрини. Натиск веде на екран пошуку, де
        введення і є сенсом екрана.
      */}
      {showSearch ? (
      <View style={styles.searchRow}>
        <Pressable
          style={styles.searchBox}
          onPress={onSearch}
          accessibilityRole="search"
          accessibilityLabel="Пошук товарів"
        >
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <Text style={styles.searchText}>Назва або артикул…</Text>
        </Pressable>

        <Pressable
          style={styles.scanButton}
          onPress={onScan}
          accessibilityRole="button"
          accessibilityLabel="Сканувати штрихкод"
        >
          <Ionicons name="barcode-outline" size={22} color={colors.ink} />
        </Pressable>
      </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.ink,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: space.sm },
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

  actions: { flexDirection: "row", alignItems: "center", gap: space.xs },
  /** 44×44 — менше пальцем не влучиш. */
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  badgeDot: {
    position: "absolute",
    top: 6,
    right: 4,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: colors.sale,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeDotText: { fontSize: 10, fontWeight: "800", color: "#FFFFFF" },

  searchRow: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 46,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
  },
  searchText: { fontSize: 14, color: colors.textMuted },
  scanButton: {
    width: 46,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
});
