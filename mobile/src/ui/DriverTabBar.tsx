/**
 * Нижнє меню водія: чотири розділи, і тільки вони.
 *
 * «Сьогодні» — нативний екран дня, решта поки відкривається кабінетом у
 * WebView. Це навмисно: панель має бути на місці з першого релізу, інакше
 * водій, який звик тикати в нижній край, після переїзду одного екрана в натив
 * втрачає вхід до решти. Коли екран переїде — тут зміниться лише адреса.
 */

import { useRouter } from "expo-router";
import { TabBar, type TabDef } from "./TabBar";
import { Icon } from "./Icon";

export const DRIVER_TAB_BAR_HEIGHT = 80;

export function DriverTabBar({ active = "today" }: { active?: "today" }) {
  const router = useRouter();

  const tabs: TabDef[] = [
    {
      href: "/day",
      label: "Сьогодні",
      icon: <Icon name="truck" size={22} color={active === "today" ? "#FFD600" : "#FFFFFF80"} />,
      exact: true,
    },
    ...([
      { label: "Клієнти", icon: "map" as const, target: "/driver/map" },
      { label: "Історія", icon: "history" as const, target: "/driver/history" },
      { label: "Акаунт", icon: "user" as const, target: "/driver/profile" },
    ].map((t) => ({
      label: t.label,
      icon: <Icon name={t.icon} size={22} color="#FFFFFF80" />,
      // replace, а не push: інакше кожен тап додає ще один WebView у стек.
      onClick: () => router.replace({ pathname: "/cabinet", params: { target: t.target } }),
    })) as TabDef[]),
  ];

  return <TabBar tabs={tabs} wide />;
}
