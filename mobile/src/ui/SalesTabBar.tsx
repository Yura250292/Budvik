/**
 * Нижнє меню на нативних екранах торгового.
 *
 * Заради чого. Кабінет має свою нижню панель, але вона живе всередині
 * WebView. Щойно торговий тиснув «Зміна», відкривався нативний екран — і
 * навігація зникала зовсім: назад вела тільки стрілка в шапці. У водія на
 * «Моєму дні» панель є, у торгового на «Зміні» не було, і це читалося як
 * «застосунок кудись провалився».
 *
 * Вкладки ті самі й у тому ж порядку, що на сайті (SalesBottomNav) — інакше
 * при переході з кабінету в натив вони б переставлялися під пальцем.
 *
 * Перехід у кабінет робимо replace, а не push: інакше кожен тап додавав би
 * ще один WebView у стек, а з ним і ще одну сесію.
 */

import { useRouter } from "expo-router";
import { TabBar, type TabDef } from "./TabBar";
import { Icon } from "./Icon";

/** Куди веде вкладка в кабінеті. Шлях той самий, що на сайті. */
const CABINET_TABS: Array<{ label: string; icon: Parameters<typeof Icon>[0]["name"]; target: string }> = [
  { label: "Головна", icon: "layout-dashboard", target: "/sales" },
  { label: "Клієнти", icon: "store", target: "/sales/clients" },
  { label: "Карта", icon: "map", target: "/sales/map" },
  { label: "Документи", icon: "file-text", target: "/sales/orders" },
  { label: "Каталог", icon: "book-open", target: "/sales/catalog" },
];

export function SalesTabBar({ active = "shift" }: { active?: "shift" }) {
  const router = useRouter();

  const tabs: TabDef[] = CABINET_TABS.map((t) => ({
    label: t.label,
    icon: <Icon name={t.icon} size={22} color="#FFFFFF80" />,
    onClick: () => router.replace({ pathname: "/cabinet", params: { target: t.target } }),
  }));

  // «Зміна» — це екран, на якому ми зараз. href робить її активною.
  tabs.push({
    href: "/shift",
    label: "Зміна",
    icon: <Icon name="gauge" size={22} color={active === "shift" ? "#FFD600" : "#FFFFFF80"} />,
    exact: true,
  });

  return <TabBar tabs={tabs} />;
}
