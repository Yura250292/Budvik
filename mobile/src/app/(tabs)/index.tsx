/**
 * Головна: банери, полиці й швидкі входи.
 *
 * Усе приходить одним запитом /api/v1/home — п'ять окремих походів по мережі
 * означали б, що екран збирається шматками, і на слабкому звʼязку це секунди
 * блимання.
 *
 * Сканера тут немає навмисно. Він потрібен людині, яка стоїть у магазині з
 * коробкою в руках, а не тій, що гортає каталог із дивана; його місце — поруч
 * із полем пошуку, де він і лишився. На головній він займав третину смуги дій,
 * відповідаючи на питання, якого в цей момент ніхто не ставить.
 */

import { useRef, useState } from "react";
import { ScrollView, View, Text, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { ProductGridSkeleton } from "@/components/Skeleton";
import { BrandTile } from "@/components/BrandTile";
import { BrandBannerRail, type ShowcaseBrand } from "@/components/BrandBannerRail";
import { SectionTiles, type SectionTile } from "@/components/SectionTiles";
import { addToCart } from "@/lib/cart";
import type { CardDto } from "@/api/types";
import { colors, space, radius, formatPositions } from "@/theme";

type Banner = {
  id: string;
  title: string;
  subtitle: string | null;
  icon: string;
  color: string;
  /** Знімок товару з добірки. Старіші збірки сервера його не шлють. */
  image?: string | null;
  search: string;
  /** Полиця на цьому ж екрані, до якої веде банер. */
  shelf?: string;
  /** Банер веде в каталог цілком, а не в добірку. */
  catalog?: boolean;
};
type Shelf = { id: string; title: string; items: CardDto[] };
type Toc = { sections: SectionTile[] };
type Home = {
  banners: Banner[];
  shelves: Shelf[];
  brands: { slug: string; name: string; count: number; color?: string | null; logoUrl?: string | null }[];
  /** Вітрина брендів банерами. Старіші збірки сервера її не шлють. */
  brandShowcase?: ShowcaseBrand[];
};

export default function HomeScreen() {
  const router = useRouter();

  /* Банер на всю ширину екрана мінус поля. Ширину беремо в системи, а не
     зашиваємо: 390 px це лише один із розмірів, а на планшеті в горизонталі
     банер має розтягтися разом з екраном. */
  const { width } = useWindowDimensions();
  const bannerWidth = width - space.md * 2;
  const bannerStride = bannerWidth + space.md;
  const [banner, setBanner] = useState(0);

  /* Банер може вести до полиці на цьому ж екрані, а не в окремий список.
     Позицію полиці запам'ятовуємо при відмальовці: рахувати її наперед не
     можна, бо вище лежать банери й розділи змінної висоти. */
  const scrollRef = useRef<ScrollView>(null);
  const shelfY = useRef<Record<string, number>>({});

  function openBanner(b: Banner) {
    if (b.catalog) {
      router.push("/catalog");
      return;
    }
    if (b.shelf) {
      const y = shelfY.current[b.shelf];
      if (y !== undefined) {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - space.md), animated: true });
        return;
      }
    }
    router.push({ pathname: "/list", params: { search: b.search, title: b.title } });
  }

  const { data, isLoading } = useQuery({
    queryKey: ["home"],
    queryFn: async (): Promise<Home> => {
      const r = await fetch(`${API_BASE}/api/v1/home`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 10 * 60_000,
  });

  /*
   * Ключ той самий, що на вкладці «Каталог», — тож перехід між головною і
   * каталогом не робить другого запиту, а користується вже завантаженим.
   */
  const toc = useQuery({
    queryKey: ["catalog", "toc"],
    queryFn: async (): Promise<Toc> => {
      const r = await fetch(`${API_BASE}/api/v1/catalog/toc`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 60 * 60_000,
  });

  return (
    <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={{ paddingBottom: space.xl }}>
      {/*
        Замість чорного банера з гаслом — рядок пошуку.

        Гасло «БУДВІК27 — ваш світ інструментів» займало третину екрана й не
        повідомляло людині нічого, чого вона не знає: вона щойно відкрила саме
        цей застосунок. Поруч стояли дві великі кнопки, і одна з них вела в
        «Каталог», який і так є в нижній навігації. Ті самі пікселі тепер
        відповідають на питання, з яким сюди заходять, — «де шукати».

        Не поле вводу, а кнопка, схожа на поле: клавіатура, що вискакує на
        головній, ховає половину вітрини. Натиск веде на екран пошуку, де
        введення і є сенсом екрана.
      */}
      <View style={styles.searchRow}>
        <Pressable
          style={styles.searchBox}
          onPress={() => router.push("/search")}
          accessibilityRole="search"
          accessibilityLabel="Пошук товарів"
        >
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <Text style={styles.searchText}>Назва або артикул…</Text>
        </Pressable>
        <Pressable
          style={styles.scanButton}
          onPress={() => router.push("/scan")}
          accessibilityRole="button"
          accessibilityLabel="Сканувати штрихкод"
        >
          <Ionicons name="barcode-outline" size={22} color={colors.ink} />
        </Pressable>
      </View>

      {/*
        Банери на всю ширину, з крапками під ними.

        Було 300 px із 390 — банер займав чотири п'ятих смуги, а обрізаний край
        сусіда виглядав не як «гортай далі», а як помилка верстки. Тепер один
        банер заповнює екран цілком, а якщо їх кілька — гортаються посторінково,
        і крапки чесно кажуть, скільки їх усього.
      */}
      {data?.banners.length ? (
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            /* snapToInterval, а не pagingEnabled: перше зупиняє гортання за
               шириною картки разом із проміжком, друге — за шириною самої
               стрічки, тож із полями банери поступово з'їжджали б набік. */
            snapToInterval={bannerStride}
            snapToAlignment="start"
            decelerationRate="fast"
            contentContainerStyle={styles.bannerRow}
            onScroll={(e) =>
              setBanner(Math.round(e.nativeEvent.contentOffset.x / bannerStride))
            }
            scrollEventThrottle={16}
          >
            {data.banners.map((b) => (
              <Pressable
                key={b.id}
                style={[styles.banner, { width: bannerWidth, backgroundColor: b.color }]}
                onPress={() => openBanner(b)}
                accessibilityRole="button"
                accessibilityLabel={`${b.title}. ${b.subtitle ?? ""}`}
              >
                {/* Ряд, а не стовпчик: знімок стоїть окремою колонкою праворуч.
                    Накладений поверх тексту, він перекривав заголовок — а обрізати
                    заголовок заради картинки означає зіпсувати саме те, заради
                    чого банер існує. */}
                <View style={styles.bannerBody}>
                  <Text style={styles.bannerTitle}>{b.title}</Text>
                  {b.subtitle ? <Text style={styles.bannerText}>{b.subtitle}</Text> : null}
                  <View style={styles.bannerCta}>
                    <Text style={styles.bannerCtaText}>Дивитись</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.ink} />
                  </View>
                </View>

                {/* Фото товару замість emoji: ☀️ однаково позначає літо, погоду
                    й вихідний, а знімок показує те, що за банером справді лежить.
                    Біла плитка під ним — навмисна: знімки з 1С зняті на білому й
                    без прозорості, тож на кольоровому тлі однаково була б біла
                    пляма; у рамці вона читається як частина верстки. */}
                {b.image ? (
                  <View style={styles.bannerThumb}>
                    <Image
                      source={b.image}
                      style={styles.bannerImage}
                      alt=""
                      contentFit="contain"
                      cachePolicy="memory-disk"
                      transition={150}
                    />
                  </View>
                ) : (
                  <Text style={styles.bannerIcon}>{b.icon}</Text>
                )}
              </Pressable>
            ))}
          </ScrollView>

          {data.banners.length > 1 ? (
            <View style={styles.dots}>
              {data.banners.map((b, i) => (
                <View key={b.id} style={[styles.dot, i === banner && styles.dotOn]} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/*
        Розділи каталогу — перше, що бачить покупець після банерів.
        Він приходить із питанням «мені потрібна болгарка», а не «покажіть усе
        від SIGMA»; бренд він згадує тоді, коли вже знає, що шукає, — тому
        стрічка брендів стоїть після розділів, а не замість них.
      */}
      {toc.data?.sections.length ? (
        <>
          <View style={styles.shelfHead}>
            <Text style={styles.shelfTitle}>Розділи каталогу</Text>
          </View>
          <View style={{ paddingBottom: space.md }}>
            <SectionTiles sections={toc.data.sections} />
          </View>
        </>
      ) : null}

      {/*
        Бренди. Банерами, коли сервер їх присилає, — фірмовий колір, чим бренд
        є і як виглядає його товар. Старий сервер вітрини не знає, тож
        лишається запасний рядок дрібних знаків: застосунок оновлюється не в
        той самий день, що сайт, і без цього екран просто втратив би бренди.
      */}
      {data?.brandShowcase?.length ? (
        <>
          <View style={styles.shelfHead}>
            <Text style={styles.shelfTitle}>Бренди</Text>
          </View>
          <View style={{ paddingTop: space.sm }}>
            <BrandBannerRail
              brands={data.brandShowcase}
              onOpen={(b) =>
                router.push({ pathname: "/list", params: { brand: b.slug, title: b.name } })
              }
            />
          </View>
        </>
      ) : data?.brands.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {data.brands.map((b) => (
            <Pressable
              key={b.slug}
              onPress={() =>
                router.push({ pathname: "/list", params: { brand: b.slug, title: b.name } })
              }
              accessibilityLabel={`${b.name}, ${formatPositions(b.count)}`}
            >
              <BrandTile brand={b} size={40} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {isLoading ? (
        <ProductGridSkeleton count={4} />
      ) : (
        data?.shelves.map((shelf) => (
          <View
            key={shelf.id}
            /* Запам'ятовуємо, де полиця опинилась: банер із полем shelf веде
               саме сюди, а порахувати позицію наперед не можна — вище лежать
               банери й розділи змінної висоти. */
            onLayout={(e) => {
              shelfY.current[shelf.id] = e.nativeEvent.layout.y;
            }}
          >
            <View style={styles.shelfHead}>
              <Text style={styles.shelfTitle}>{shelf.title}</Text>
            </View>
            <View style={styles.grid}>
              {shelf.items.map((p) => (
                <View key={p.id} style={{ width: "48%" }}>
                  <ProductCard product={p} onAdd={(x) => addToCart(x)} />
                </View>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  searchRow: { flexDirection: "row", gap: space.sm, padding: space.md },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchText: { fontSize: 14, color: colors.textMuted },
  scanButton: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },

  bannerRow: { paddingHorizontal: space.md, gap: space.md, paddingBottom: space.md },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
  },
  bannerBody: { flex: 1, gap: space.xs },
  bannerIcon: { fontSize: 26 },
  bannerThumb: {
    width: 86,
    height: 86,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  bannerImage: { width: "100%", height: "100%" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingBottom: space.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { width: 20, backgroundColor: colors.ink },
  bannerTitle: { fontSize: 17, fontWeight: "800", color: colors.ink },
  bannerText: { fontSize: 13, lineHeight: 18, color: colors.ink, opacity: 0.75 },
  bannerCta: { marginTop: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs },
  bannerCtaText: { fontSize: 13, fontWeight: "700", color: colors.ink },

  chipRow: { paddingHorizontal: space.md, gap: space.sm, paddingBottom: space.md },

  shelfHead: { paddingHorizontal: space.md, paddingTop: space.md },
  shelfTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    padding: space.sm,
  },
});
