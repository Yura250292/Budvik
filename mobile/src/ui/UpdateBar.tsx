/**
 * «Вийшло оновлення — натисніть, щоб перезавантажити».
 *
 * Без неї виправлення доїжджає до планшета аж із ДРУГОГО холодного старту:
 * expo-updates із `checkAutomatically: "ON_LOAD"` тільки завантажує оновлення
 * на запуску, а застосовує його на наступному. Планшет у машині не вимикають
 * тижнями — і виправлення, опубліковане вранці, могло не побачити людини
 * взагалі.
 *
 * Смуга мусить бути на екрані, який відкривають щодня: у водія це «Мій день»,
 * у торгового — кабінет. Один компонент на обидва, бо два однакові розійшлися
 * б на першій же правці.
 */

import { Text, Pressable, StyleSheet } from "react-native";
import * as Updates from "expo-updates";
import { c, sp } from "./tokens";
import { Icon } from "./Icon";

export function UpdateBar() {
  const { isUpdatePending } = Updates.useUpdates();
  if (!isUpdatePending) return null;

  return (
    <Pressable style={s.bar} onPress={() => Updates.reloadAsync().catch(() => {})}>
      <Icon name="refresh-cw" size={16} color={c.bk} />
      <Text style={s.label}>Вийшло оновлення — натисніть, щоб перезавантажити</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: sp.sm,
    height: 44,
    backgroundColor: c.brand,
  },
  label: { color: c.bk, fontSize: 13, fontWeight: "700" },
});
