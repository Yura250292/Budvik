/**
 * Сканер штрихкодів і QR.
 *
 * Промах не має бути глухим кутом: людина стоїть із коробкою в руках, і
 * «нічого не знайдено» без продовження — найгірше, що тут можна показати.
 * Сервер на невпізнаний код повертає схоже за початком артикула, і ми
 * показуємо саме це, а не помилку.
 */

import { useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { api } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import type { CardDto } from "@/api/types";
import { colors, space, radius } from "@/theme";

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [miss, setMiss] = useState<{ code: string; fallback: CardDto[] } | null>(null);

  if (!permission) return <ActivityIndicator style={{ marginTop: space.xl }} color={colors.ink} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.explain}>
          Щоб знайти інструмент за кодом із цінника, застосунку потрібна камера.
        </Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Дозволити камеру</Text>
        </Pressable>
      </View>
    );
  }

  async function onScanned(raw: string) {
    // Камера шле кадри потоком: без цього прапорця один піднесений код
    // перетворюється на десятки запитів за секунду.
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.lookup(raw);
      if (result.match === "none") {
        setMiss({ code: result.code, fallback: result.fallback });
      } else {
        router.replace({
          pathname: "/product/[slug]",
          params: { slug: result.product.slug },
        });
      }
    } catch {
      setMiss({ code: raw, fallback: [] });
    } finally {
      setBusy(false);
    }
  }

  if (miss) {
    return (
      <View style={styles.screen}>
        <Text style={styles.missTitle}>Код {miss.code} не впізнали</Text>
        {miss.fallback.length > 0 ? (
          <>
            <Text style={styles.missHint}>Можливо, це щось із цього:</Text>
            <FlatList
              data={miss.fallback}
              keyExtractor={(i) => i.id}
              numColumns={2}
              contentContainerStyle={{ padding: space.xs }}
              renderItem={({ item }) => <ProductCard product={item} />}
            />
          </>
        ) : (
          <Text style={styles.missHint}>
            Спробуйте пошук за назвою — не на всіх коробках код збігається з нашим артикулом.
          </Text>
        )}
        <Pressable style={styles.button} onPress={() => setMiss(null)}>
          <Text style={styles.buttonText}>Сканувати ще раз</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{
          // QR — власні цінники, решта — коди виробників на коробках.
          barcodeTypes: ["qr", "ean13", "ean8", "code128", "code39", "upc_a"],
        }}
        onBarcodeScanned={({ data }) => onScanned(data)}
      />
      <View style={styles.overlay}>
        <View style={styles.frame} />
        <Text style={styles.overlayText}>
          {busy ? "Шукаємо…" : "Наведіть на штрихкод або QR із цінника"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  explain: { textAlign: "center", color: colors.text, fontSize: 15, lineHeight: 21 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: {
    width: 240,
    height: 160,
    borderWidth: 3,
    borderColor: colors.brand,
    borderRadius: radius.md,
  },
  overlayText: {
    marginTop: space.lg,
    color: "#FFFFFF",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: space.xl,
  },
  missTitle: { padding: space.lg, fontSize: 16, fontWeight: "700", color: colors.text },
  missHint: { paddingHorizontal: space.lg, color: colors.textMuted, lineHeight: 20 },
  button: {
    margin: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  buttonText: { fontWeight: "700", color: colors.ink },
});
