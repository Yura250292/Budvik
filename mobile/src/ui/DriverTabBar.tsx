/**
 * Нижня панель водія — плаваюча чорна капсула з макета.
 *
 * «Сьогодні» — нативний екран дня, решта поки відкривається кабінетом у
 * WebView. Це навмисно: панель має бути на місці з першого релізу, інакше
 * водій, який звик тикати в нижній край, після переїзду одного екрана в натив
 * втрачає вхід до решти. Коли екран переїде — тут зміниться лише адреса.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { c, sp } from "./tokens";
import { Icon, type IconName } from "./Icon";

export type DriverTab = "today" | "clients" | "history" | "account";

const TABS: Array<{ key: DriverTab; label: string; icon: IconName; target: string | null }> = [
  { key: "today", label: "Сьогодні", icon: "truck", target: null },
  { key: "clients", label: "Клієнти", icon: "map", target: "/driver/map" },
  { key: "history", label: "Історія", icon: "history", target: "/driver/history" },
  { key: "account", label: "Акаунт", icon: "user", target: "/driver/profile" },
];

/** Висота панелі з полем — щоб екран під нею лишав стільки ж вільного місця. */
export const DRIVER_TAB_BAR_HEIGHT = 80;

export function DriverTabBar({ active = "today" }: { active?: DriverTab }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.wrap, { paddingBottom: 12 + insets.bottom }]}>
      <View style={s.bar}>
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <Pressable
              key={t.key}
              style={({ pressed }) => [s.tab, on && s.tabOn, pressed && { opacity: 0.7 }]}
              onPress={() => {
                if (on) return;
                if (t.target === null) {
                  router.replace("/day");
                  return;
                }
                router.push({ pathname: "/cabinet", params: { target: t.target } });
              }}
            >
              <Icon name={t.icon} size={22} color={on ? c.brand : "#FFFFFF80"} />
              <Text style={[s.label, on ? s.labelOn : s.labelOff]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: 4, paddingHorizontal: sp.gap, backgroundColor: c.bg },
  bar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: c.bk,
    borderRadius: 32,
    padding: 6,
    // Тінь відриває капсулу від списку точок, який під нею прокручується.
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 12,
  },
  tab: {
    width: 72,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tabOn: { backgroundColor: "#FFD6001F" },
  label: { fontSize: 10 },
  labelOn: { color: c.brand, fontWeight: "600" },
  labelOff: { color: "#FFFFFF80", fontWeight: "500" },
});
