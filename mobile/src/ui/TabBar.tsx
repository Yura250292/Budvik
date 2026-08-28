/**
 * Нижня панель нативних екранів — плаваюча чорна капсула з макета.
 *
 * Одна на обидві ролі: у водія «Мій день», у торгового «Зміна». Дві копії
 * розійшлися б на першій же правці відступу, а панель мусить виглядати
 * однаково — на планшеті її бачать обидва.
 *
 * Висота цілі дотику 52 px: у машині в менше не влучають.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { Link, usePathname, type Href } from "expo-router";
import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { c, sp } from "./tokens";

export type TabDef = {
  /** Нативний маршрут. Немає — вкладка щось робить сама (веде в кабінет). */
  href?: Href;
  label: string;
  icon: ReactNode;
  /** Активною вважається лише точна адреса. */
  exact?: boolean;
  onClick?: () => void;
};

/** Скільки місця екран мусить лишити під собою. */
export const TAB_BAR_HEIGHT = 80;

export function TabBar({ tabs, wide = false }: { tabs: TabDef[]; wide?: boolean }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const isActive = (t: TabDef) => {
    if (typeof t.href !== "string") return false;
    return t.exact ? pathname === t.href : pathname.startsWith(t.href);
  };

  return (
    <View style={[s.wrap, { paddingBottom: 12 + insets.bottom }]}>
      <View style={s.bar}>
        {tabs.map((t) => {
          const on = isActive(t);
          const style = [s.tab, wide && s.tabWide, on && s.tabOn];
          const inner = (
            <>
              {t.icon}
              <Text style={[s.label, on ? s.labelOn : s.labelOff]}>{t.label}</Text>
            </>
          );

          if (!t.href) {
            return (
              <Pressable
                key={t.label}
                onPress={t.onClick}
                style={({ pressed }) => [...style, pressed && { opacity: 0.7 }]}
              >
                {inner}
              </Pressable>
            );
          }
          return (
            <Link key={t.label} href={t.href} asChild>
              <Pressable style={({ pressed }) => [...style, pressed && { opacity: 0.7 }]}>
                {inner}
              </Pressable>
            </Link>
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
    // Тінь відриває капсулу від списку, що під нею прокручується.
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 12,
  },
  tab: {
    width: 58,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tabWide: { width: 72 },
  tabOn: { backgroundColor: "#FFD6001F" },
  label: { fontSize: 10 },
  labelOn: { color: c.brand, fontWeight: "600" },
  labelOff: { color: "#FFFFFF80", fontWeight: "500" },
});
