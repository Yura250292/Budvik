/**
 * Таб-бар.
 *
 * Склад повторює BottomNav сайту (Головна / Каталог / Пошук / Кошик /
 * Кабінет): людина, яка ходила на вітрину з телефона, має знайти все там само.
 */

import { useEffect, useState } from "react";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getScope } from "@/lib/auth-store";
import { useCartCount } from "@/lib/useCartCount";
import { IS_STAFF_BUILD } from "@/lib/flavor";
import { colors } from "@/theme";

export default function TabsLayout() {
  /**
   * Працівник не має бачити вітрину на холодному старті.
   *
   * Область токена вирішена ще при вході й лежить поруч із ним. Перевіряємо її
   * тут, до відмальовки вкладок: інакше торговий на секунду бачив би магазин,
   * а потім екран стрибав би в кабінет.
   *
   * Куди саме вести — вирішує сервер за роллю (lib/app/role-target.ts), тож
   * адресу тут не передаємо: одне правило на всі входи.
   */
  const cartCount = useCartCount();
  const [scope, setScope] = useState<"shop" | "track" | null | undefined>(undefined);

  useEffect(() => {
    getScope().then(setScope);
  }, []);

  if (scope === undefined) return null;
  if (scope === "track" && IS_STAFF_BUILD) return <Redirect href="/cabinet" />;

  return (
    <Tabs
      screenOptions={{
        /*
         * Шапка решти вкладок: та сама чорна, але без сірої лінії знизу й із
         * помітнішим заголовком. Тонка світла риска під чорним на чорному
         * читалася як шов, а не як межа, і додавала екрану вигляд заготовки.
         */
        headerStyle: { backgroundColor: colors.ink },
        headerShadowVisible: false,
        headerTintColor: colors.brand,
        headerTitleStyle: { color: "#FFFFFF", fontWeight: "800", fontSize: 19, letterSpacing: 0.2 },
        headerTitleAlign: "left",
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Головна",
          /*
           * Шапку тут малює сам екран (AppHeader): знак, дії й пошук в одному
           * блоці. Смуга навігатора над ним була б третьою поспіль — логотип,
           * заголовок, пошук, — і з'їдала б чверть екрана, не роблячи нічого.
           */
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="catalog"
        options={{
          title: "Каталог",
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Пошук",
          tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Кошик",
          // Бейдж — єдине підтвердження, що «У кошик» спрацювало: окремого
          // повідомлення після дотику немає навмисно, воно перекривало б
          // наступну картку в списку.
          tabBarBadge: cartCount > 0 ? cartCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.sale, fontSize: 11 },
          tabBarIcon: ({ color, size }) => <Ionicons name="cart-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Кабінет",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />

      {/*
        Екрани без власної кнопки в таб-барі.
        Вони лежать усередині навігатора вкладок саме для того, щоб нижня
        навігація нікуди не зникала: людина, яка провалилась у картку товару,
        має змогти перейти в кошик одним дотиком, а не через «назад». href:null
        прибирає кнопку, але не сам екран.
      */}
      <Tabs.Screen name="product/[slug]" options={{ href: null, title: "Товар" }} />
      <Tabs.Screen name="list" options={{ href: null, title: "Каталог" }} />
      <Tabs.Screen name="wishlist" options={{ href: null, title: "Обране" }} />
      <Tabs.Screen name="orders/index" options={{ href: null, title: "Мої замовлення" }} />
      <Tabs.Screen name="checkout" options={{ href: null, title: "Оформлення" }} />
    </Tabs>
  );
}
