/**
 * Іконки макета — одним іменем.
 *
 * Макет намальовано на Lucide, а в застосунку є лише шрифтові набори
 * @expo/vector-icons. Тягнути lucide-react-native не можна: він вимагає
 * react-native-svg, тобто нативний модуль, тобто новий APK на кожному
 * планшеті заради іконок. Тому тут таблиця «ім'я з макета → набір і гліф»,
 * і решта коду пише саме ті назви, що стоять у Pencil: звіряти верстку з
 * макетом можна пошуком, а не здогадкою.
 *
 * Feather — той самий предок, що й у Lucide, тож більшість гліфів збігається
 * малюнком. Те, чого в ньому немає, беремо з MaterialCommunityIcons.
 */

import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps } from "react";

type FeatherName = ComponentProps<typeof Feather>["name"];
type MdiName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const FEATHER = {
  "chevron-left": "chevron-left",
  "chevron-right": "chevron-right",
  "chevron-up": "chevron-up",
  "chevron-down": "chevron-down",
  check: "check",
  x: "x",
  camera: "camera",
  play: "play",
  flag: "flag",
  upload: "upload",
  "triangle-alert": "alert-triangle",
  "cloud-off": "cloud-off",
  "wifi-off": "wifi-off",
  "refresh-cw": "refresh-cw",
  "battery-charging": "battery-charging",
  square: "square",
  pencil: "edit-2",
  "rotate-ccw": "rotate-ccw",
  navigation: "navigation",
  truck: "truck",
  map: "map",
  user: "user",
  bell: "bell",
  clock: "clock",
  "map-pin": "map-pin",
} satisfies Record<string, FeatherName>;

const MDI = {
  "badge-alert": "alert-decagram",
  "clock-alert": "clock-alert-outline",
  history: "history",
  "shield-check": "shield-check",
  "scan-line": "line-scan",
  banknote: "cash",
  hourglass: "timer-sand",
  "map-pin-check": "map-marker-check",
  "route-off": "map-marker-off",
  gauge: "gauge",
} satisfies Record<string, MdiName>;

/**
 * `satisfies`, а не анотація `Record<string, …>`: анотація стерла б літеральні
 * ключі, `IconName` перетворився б на звичайний `string`, і помилка в імені
 * («history-typo») мовчки малювалася б кружечком-заглушкою. З `satisfies` таку
 * описку ловить компілятор — до того, як вона поїде на планшет.
 */
export type IconName = keyof typeof FEATHER | keyof typeof MDI;

export function Icon({
  name,
  size = 18,
  color,
}: {
  name: IconName;
  size?: number;
  color: string;
}) {
  if (name in MDI) {
    const mdi = MDI[name as keyof typeof MDI];
    return <MaterialCommunityIcons name={mdi} size={size} color={color} />;
  }
  const feather = FEATHER[name as keyof typeof FEATHER];
  return <Feather name={feather} size={size} color={color} />;
}
