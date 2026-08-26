/**
 * Каталог у двох розрізах: за розділами й за брендами.
 *
 * Розділи стоять першими навмисно. Покупець приходить із питанням «мені
 * потрібна болгарка», а не «покажіть усе від SIGMA» — бренд він згадує тоді,
 * коли вже знає, що шукає. Список брендів як єдиний вхід відповідав на друге
 * питання й мовчав на перше.
 *
 * Категорійне дерево з 1С тут не використовується взагалі: 84% товарів лежать
 * у звалищі «Імпорт з 1С», а решта груп називається числами. Розділи й типи
 * виводяться з назв товарів — тим самим кодом, що й зміст на сайті.
 */

import { useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/api/client";
import { RowSkeleton } from "@/components/Skeleton";
import { Image } from "expo-image";
import { BrandTile } from "@/components/BrandTile";
import { EmptyState } from "@/components/EmptyState";
import { colors, space, radius } from "@/theme";

type TocLine = { key: string; label: string; count: number };
type TocSection = {
  id: string;
  title: string;
  icon: string;
  lines: TocLine[];
  total: number;
  /** Знімок товару з розділу. Старіші збірки сервера його не шлють. */
  image?: string | null;
};
type Toc = { sections: TocSection[]; other: TocLine[]; total: number };

type Brand = { slug: string; name: string; count: number; color?: string | null; logoUrl?: string | null };
type BrandTree = { main: Brand[]; tail: Brand[]; total: number };

type Mode = "sections" | "brands";

export default function CatalogScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sections");
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toc = useQuery({
    queryKey: ["catalog", "toc"],
    queryFn: async (): Promise<Toc> => {
      const r = await fetch(`${API_BASE}/api/v1/catalog/toc`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 60 * 60_000,
  });

  const brandTree = useQuery({
    queryKey: ["brands"],
    queryFn: async (): Promise<BrandTree> => {
      const r = await fetch(`${API_BASE}/api/v1/brands`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 60 * 60_000,
    enabled: mode === "brands",
  });

  const loading = mode === "sections" ? toc.isLoading : brandTree.isLoading;
  const failed = mode === "sections" ? toc.error : brandTree.error;

  return (
    <View style={styles.screen}>
      {/* Перемикач розрізу. Два варіанти — сегменти, а не вкладки: вкладки
          обіцяють окремі екрани зі своєю історією, а тут один список. */}
      <View style={styles.segments}>
        {(
          [
            ["sections", "За розділами"],
            ["brands", "За брендами"],
          ] as const
        ).map(([m, label]) => (
          <Pressable
            key={m}
            style={[styles.segment, mode === m && styles.segmentOn]}
            onPress={() => setMode(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ padding: space.md }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : failed ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Каталог не завантажився"
          hint="Схоже, немає звʼязку. Спробуйте ще раз за хвилину."
        />
      ) : mode === "sections" ? (
        <FlatList
          data={toc.data?.sections ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: space.md }}
          ListHeaderComponent={
            <Text style={styles.total}>Усього позицій: {toc.data?.total ?? 0}</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable
                style={styles.cardHead}
                onPress={() => setOpenSection((s) => (s === item.id ? null : item.id))}
              >
                {/* Знімок товару замість emoji: 🎨 однаково позначає фарбу,
                    дизайн і свято, тож як мітка розділу він не працює — око все
                    одно читає підпис. Якщо сервер знімка не дав, лишається
                    стара піктограма. */}
                {item.image ? (
                  <Image
                    source={item.image}
                    style={styles.thumb}
                    alt=""
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    transition={120}
                  />
                ) : (
                  <Text style={styles.icon}>{item.icon}</Text>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardCount}>{item.total} позицій</Text>
                </View>
                <Ionicons
                  name={openSection === item.id ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>

              {openSection === item.id ? (
                <View style={styles.lines}>
                  {item.lines.map((line) => (
                    <Pressable
                      key={line.key}
                      style={styles.line}
                      onPress={() =>
                        router.push({
                          pathname: "/list",
                          params: { type: line.key, title: line.label },
                        })
                      }
                    >
                      <Text style={styles.lineLabel}>{line.label}</Text>
                      <Text style={styles.lineCount}>{line.count}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          )}
        />
      ) : (
        <FlatList
          data={[...(brandTree.data?.main ?? []), ...(brandTree.data?.tail ?? [])]}
          keyExtractor={(b) => b.slug}
          contentContainerStyle={{ padding: space.md }}
          ListHeaderComponent={
            <Text style={styles.total}>Усього позицій: {brandTree.data?.total ?? 0}</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.brandRow}
              onPress={() =>
                router.push({ pathname: "/list", params: { brand: item.slug, title: item.name } })
              }
            >
              <BrandTile brand={item} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardCount}>{item.count} позицій</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  segments: {
    flexDirection: "row",
    gap: space.sm,
    padding: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 14, color: colors.text },
  segmentTextOn: { fontWeight: "700", color: colors.brand },

  total: { marginBottom: space.md, fontSize: 13, color: colors.textMuted },

  card: {
    marginBottom: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 64 },
  icon: { fontSize: 22 },
  thumb: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surface },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  cardCount: { marginTop: 2, fontSize: 12, color: colors.textMuted },

  lines: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: space.lg,
  },
  lineLabel: { fontSize: 14, color: colors.text },
  lineCount: { fontSize: 12, color: colors.textMuted },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 72,
    paddingHorizontal: space.md,
    marginBottom: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
