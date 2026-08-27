/**
 * Головна застосунку — одним запитом.
 *
 * П'ять окремих походів по мережі на холодний старт означали б, що людина
 * дивиться, як екран збирається шматками; на 3G у селі це десять секунд
 * блимання. Тут усе рахується паралельно на сервері й приїжджає одним шматком.
 *
 * Банери беруться з SeasonalPromo, які заводить адмінка. Якщо їх немає (а
 * зараз їх немає жодного), показуємо сезонну добірку за ключовими словами —
 * порожня головна гірша за автоматичну.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CARD_SELECT } from "@/lib/catalog/query";
import { showableProductWhere } from "@/lib/catalog/showable";
import { getShoppableBrandTree } from "@/lib/catalog/brand-tree";
import { getBrandShowcase } from "@/lib/catalog/brand-showcase";
import { getCatalogToc } from "@/lib/catalog/sections";
import { serializeCard } from "@/lib/shop/api";
import {
  getCurrentSeason, getSeasonLabel, getSeasonIcon, getSeasonColor,
  DEFAULT_SEASONAL_KEYWORDS, DEFAULT_SEASONAL_EXCLUDE,
} from "@/lib/seasonal";

/** Головна змінюється не частіше, ніж приїжджає обмін із 1С. */
export const revalidate = 600;

/** Скільки товарів у кожній полиці. Більше на телефоні однаково не гортають. */
const SHELF = 8;

export async function GET() {
  const season = getCurrentSeason();
  const now = new Date();

  const promos = await prisma.seasonalPromo.findMany({
    where: {
      isActive: true,
      OR: [
        { season },
        { season: "custom", startDate: { lte: now }, endDate: { gte: now } },
      ],
    },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true, title: true, description: true, icon: true, color: true,
      keywords: true, productIds: true,
    },
  });

  /**
   * Слова, за якими шукати сезонні товари: з акцій адміністратора, а якщо їх
   * немає — типові для пори року.
   */
  const keywords = promos.length
    ? promos.flatMap((p) => p.keywords)
    : DEFAULT_SEASONAL_KEYWORDS[season];
  const pinned = promos.flatMap((p) => p.productIds);

  const seasonalWhere = {
    ...showableProductWhere(),
    OR: [
      ...keywords.map((kw) => ({ name: { contains: kw, mode: "insensitive" as const } })),
      ...(pinned.length ? [{ id: { in: pinned } }] : []),
    ],
    // Виключення з тієї ж пори року: «зимовий» тример улітку недоречний.
    NOT: DEFAULT_SEASONAL_EXCLUDE[season].map((kw) => ({
      name: { contains: kw, mode: "insensitive" as const },
    })),
  };

  const [seasonal, promoProducts, newest, brands, showcase, toc] = await Promise.all([
    prisma.product.findMany({
      where: seasonalWhere,
      select: CARD_SELECT,
      orderBy: [{ stock: "desc" }, { priority: "desc" }],
      take: SHELF,
    }),
    /**
     * Полиця акцій. Зараз порожня — товарів із promoPrice у базі немає жодного.
     * Полиця сама зникне з екрана, доки їх не з'явиться: показувати заголовок
     * «Акції» над порожнечею гірше, ніж не показувати нічого.
     */
    prisma.product.findMany({
      where: { ...showableProductWhere(), isPromo: true, promoPrice: { not: null } },
      select: CARD_SELECT,
      orderBy: [{ priority: "desc" }, { stock: "desc" }],
      take: SHELF,
    }),
    prisma.product.findMany({
      where: showableProductWhere(),
      select: CARD_SELECT,
      orderBy: { createdAt: "desc" },
      take: SHELF,
    }),
    /* Лише бренди з наявним товаром: чипи ведуть у видачу, а не в порожній
       екран. Те саме дерево, що й у /api/v1/brands. */
    getShoppableBrandTree(),
    getBrandShowcase(),
    getCatalogToc(),
  ]);

  return NextResponse.json({
    /*
     * Банери першого екрана. Складаються з того, що в магазині справді є, а не
     * з намальованих обіцянок: сезонна добірка й обсяг каталогу. Коли
     * адміністратор заведе акцію в /admin, її банери стануть
     * першими й витіснять автоматичні — саме так, як і має бути. Той самий
     * набір, що на головній сайту: одна вітрина, два способи її показати.
     *
     * image — знімок справжнього товару з добірки, за яку відповідає банер.
     * Emoji в цій ролі читалась як заглушка: ☀️ однаково позначає літо, погоду
     * й вихідний. Поле додане поруч із icon, а не замість нього: установлену
     * збірку не можна оновити примусово, тож старі застосунки мусять і далі
     * малювати банер по-своєму.
     */
    banners: [
      ...(promos.length
        ? promos.map((p, i) => ({
            id: p.id,
            title: p.title,
            subtitle: p.description,
            icon: p.icon ?? getSeasonIcon(season),
            color: p.color,
            image: seasonal[i]?.image ?? seasonal[0]?.image ?? null,
            /** Куди веде банер: перше ключове слово як пошуковий запит. */
            search: p.keywords[0] ?? p.title,
          }))
        : seasonal.length
          ? [
              {
                id: `season-${season}`,
                title: `${getSeasonLabel(season)} — сезонні роботи`,
                subtitle: "Те, що зараз потрібно найчастіше",
                icon: getSeasonIcon(season),
                color: getSeasonColor(season),
                image: seasonal[0]?.image ?? null,
                search: keywords[0],
              },
            ]
          : []),
      {
        id: "catalog",
        title: `${toc.total.toLocaleString("uk-UA")} позицій у каталозі`,
        subtitle: "Електро та ручний інструмент, оснастка, кріплення, захист",
        icon: "🧰",
        color: "#C9D6DF",
        image: newest[0]?.image ?? null,
        /** Порожній пошук відкриває каталог цілком. */
        search: "",
        catalog: true,
      },
    ],
    /*
     * Полиці «Хіти продажу» більше немає — ні тут, ні на сайті. Вона
     * рахувалась за кількістю замовлень, а замовлень у базі поки надто мало,
     * щоб слово «хіт» щось означало: у полицю потрапляло те, що хтось узяв
     * двічі. Порожній ключ у відповіді старі збірки переживають — вони
     * малюють полиці за тим, що приїхало.
     */
    shelves: [
      { id: "promo", title: "Акції", items: promoProducts.map(serializeCard) },
      { id: "seasonal", title: `${getSeasonLabel(season)} — що беруть зараз`, items: seasonal.map(serializeCard) },
      { id: "newest", title: "Нові надходження", items: newest.map(serializeCard) },
    ].filter((s) => s.items.length > 0),
    brands: brands.main.slice(0, 10).map((b) => ({
      slug: b.slug,
      name: b.name,
      count: b.count,
      color: b.color,
      logoUrl: b.logoUrl,
    })),
    /*
     * Вітрина брендів — та сама, що на головній сайту (див.
     * lib/catalog/brand-showcase.ts): фірмовий колір, слоган, лічильник і
     * знімки товарів із каталогу бренда.
     *
     * Окремим полем, а не всередині brands: там інший набір (топ-10 за
     * кількістю) і інший вигляд у застосунку — дрібні чипи. Зв'язати їх
     * означало б, що зміна складу вітрини мовчки міняє і рядок чипів.
     * Старі збірки незнайомого ключа просто не бачать.
     *
     * Знімків беремо три: рівно стільки лягає у віяло на банері застосунку.
     * Четвертий, який є на широкому банері сайту, на телефоні вже не влазить.
     */
    brandShowcase: showcase.map((b) => ({
      slug: b.slug,
      name: b.name,
      tagline: b.tagline,
      accent: b.accent,
      /* Другий фірмовий колір і колір назви. Старі збірки їх не знають і
         малюють картку одним accent — простіше, але не зламано. */
      accentTo: b.accentTo,
      wordmark: b.wordmark,
      logoUrl: b.logoUrl,
      count: b.count,
      photos: b.photos.slice(0, 3),
    })),
  });
}
