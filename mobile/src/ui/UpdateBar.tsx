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

import { useState } from "react";
import { Text, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import * as Updates from "expo-updates";
import { c, sp } from "./tokens";
import { Icon } from "./Icon";

export function UpdateBar() {
  const { isUpdatePending } = Updates.useUpdates();
  const [busy, setBusy] = useState(false);
  if (!isUpdatePending) return null;

  /**
   * Натиск мусить мати наслідок — видимий.
   *
   * Досі помилку ковтав `.catch(() => {})`, і смуга виглядала мертвою: людина
   * тисне, нічого не відбувається, вона тисне ще раз. 02.09 так було на двох
   * планшетах одночасно. Перезавантаження може й справді не вдатися —
   * expo-updates відмовляє, коли саме зараз качається наступне оновлення, — і
   * тоді треба сказати це словами, а не мовчати.
   *
   * Запасний шлях у тексті не випадковий: холодний старт застосовує
   * завантажене оновлення так само надійно, як і ця кнопка.
   */
  const apply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Updates.reloadAsync();
    } catch (e) {
      setBusy(false);
      Alert.alert(
        "Не вдалося перезавантажити",
        `${e instanceof Error ? e.message : String(e)}\n\n` +
          "Закрийте застосунок повністю (кнопка «недавні» → змахніть убік) і " +
          "відкрийте знову — оновлення застосується само."
      );
    }
  };

  return (
    <Pressable style={s.bar} onPress={apply} disabled={busy}>
      {busy ? (
        <ActivityIndicator size="small" color={c.bk} />
      ) : (
        <Icon name="refresh-cw" size={16} color={c.bk} />
      )}
      <Text style={s.label}>
        {busy ? "Перезавантажую…" : "Вийшло оновлення — натисніть, щоб перезавантажити"}
      </Text>
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
