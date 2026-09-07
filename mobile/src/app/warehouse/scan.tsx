/**
 * Накладна: зняв — поїхала в офіс.
 *
 * Нативний екран, а не сторінка кабінету, і причина одна: камера. У WebView
 * фото береться через поле файлу, тобто через галерею й системний вибір —
 * зайвих три дотики на КОЖНУ накладну, а їх за день десятки. Тут камера
 * відкрита одразу, і між двома накладними лежить рівно одна кнопка.
 *
 * Друге, чого веб-шлях не вміє: стиснення. Камера планшета дає 4–8 МБ на
 * кадр, а на складі мережа рветься — саме розмір і був причиною, чому фото
 * «не доїжджало». Кадр звужується до 1600 px перед відправкою: дрібний шрифт
 * накладної на цій ширині ще читається, а важить вона вже кількасот кілобайт.
 *
 * Знімок лишається в застосунку до успіху. Невдача (немає звʼязку, сервер
 * мовчить) не має означати похід назад до накладної: людина натискає
 * «Надіслати ще раз», а не перезнімає — саме на цьому й губилися документи.
 */

import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Stack, useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { staffApi, StaffApiError, type WarehouseScanResult } from "@/api/staff";
import { c, r, sp } from "@/ui/tokens";
import { Body, Button, Card, CardTitle, Header, Note, Row, Screen } from "@/ui/kit";
import { Icon } from "@/ui/Icon";

/**
 * 1600 px, а не 1280 як в одометра: там читається шість великих цифр, тут —
 * таблиця на 60 рядків дрібним шрифтом, і на вужчому кадрі модель починає
 * плутати 3 з 8 у кількостях.
 */
const PHOTO_WIDTH = 1600;
const PHOTO_QUALITY = 0.8;

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

type Done = { report: WarehouseScanResult["report"]; duplicate: boolean };

export default function WarehouseScanScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [busy, setBusy] = useState(false);
  /** Знятий кадр, який ще не доїхав. Тримаємо заради «надіслати ще раз». */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  /** Скільки накладних поїхало за цей захід — щоб було видно, що робота йде. */
  const [sent, setSent] = useState(0);

  const upload = useCallback(async (uri: string) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", {
        uri,
        name: "invoice.jpg",
        type: "image/jpeg",
      } as unknown as Blob);

      const res = await staffApi.warehouseScan(form);
      setDone({ report: res.report, duplicate: res.duplicate });
      setPending(null);
      if (!res.duplicate) setSent((n) => n + 1);
    } catch (e) {
      /**
       * 422 — сервер прочитав фото, але не зміг розібрати документ. Це не
       * збій звʼязку, і лікується воно іншим: перезняти, а не повторити.
       * Тому текст сервера показуємо як є, а знімок тримаємо — раптом
       * звʼязок і справді ні до чого.
       */
      setError(e instanceof StaffApiError ? e.message : "Немає звʼязку — накладна не поїхала");
    } finally {
      setBusy(false);
    }
  }, []);

  const capture = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!shot?.uri) throw new Error("Не вдалося зняти фото");

      const small = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: PHOTO_WIDTH } }],
        { compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
      );
      setPending(small.uri);
      setBusy(false);
      await upload(small.uri);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Не вдалося зняти фото");
    }
  }, [busy, upload]);

  if (!permission) {
    return <ActivityIndicator style={{ marginTop: sp.pad }} color={c.brand} />;
  }

  if (!permission.granted) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Header title="Накладна" eyebrow="СКЛАД" />
        <Screen>
          <Card>
            <CardTitle big>Потрібна камера</CardTitle>
            <Body>
              Накладна фотографується прямо тут і одразу їде в офіс. Без доступу до камери
              лишається тільки надсилати фото з галереї через кабінет.
            </Body>
            <Button label="Дозволити камеру" icon="camera" onPress={requestPermission} />
          </Card>
        </Screen>
      </>
    );
  }

  /* ---------- Результат: що саме прочиталося ---------- */
  if (done) {
    const rep = done.report;
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Header
          title={rep.docNumber ? `№${rep.docNumber}` : "Накладна"}
          eyebrow={done.duplicate ? "ЦЕ ФОТО ВЖЕ БУЛО" : `ПОЇХАЛО В ОФІС · ${sent} ЗА ЗАХІД`}
          onBack={() => router.back()}
        />
        <Screen>
          <Card tone={done.duplicate ? "warn" : "brand"}>
            <CardTitle big>{rep.counterpartyName ?? "Контрагента не впізнано"}</CardTitle>
            <Row label="Позицій" value={String(rep.itemsCount)} />
            <Row
              label="Сума"
              value={rep.totalAmount != null ? `${money.format(rep.totalAmount)} ₴` : "не прочиталася"}
              tone={rep.totalAmount == null ? "warn" : undefined}
            />
            <Row
              label="Дата"
              value={rep.docDate ? new Date(rep.docDate).toLocaleDateString("uk-UA") : "не прочиталася"}
              tone={rep.docDate ? undefined : "warn"}
            />
            {done.duplicate && (
              <Note tone="warn">
                Ця сама накладна вже надсилалася — другої копії в офісі не зʼявилося.
              </Note>
            )}
          </Card>

          <Button
            label="Наступна накладна"
            icon="camera"
            onPress={() => {
              setDone(null);
              setPending(null);
            }}
          />
          <Button label="Готово" tone="outline" onPress={() => router.back()} />

          <Note>
            Розпізнане лягає в звіт для офісу. Залишки й документи в 1С воно не змінює — помилку в
            рядку виправляють там.
          </Note>
        </Screen>
      </>
    );
  }

  /* ---------- Невдача: знімок є, доїхати не зміг ---------- */
  if (error && pending) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Header title="Не поїхало" eyebrow="СКЛАД" onBack={() => router.back()} />
        <Screen>
          <Card tone="bad">
            <CardTitle big>Накладна лишилася в телефоні</CardTitle>
            <Body>{error}</Body>
            <Note>
              Знімок нікуди не подівся — не треба йти по накладну ще раз. Натисніть «Надіслати ще
              раз», коли звʼязок зʼявиться.
            </Note>
          </Card>

          <Button
            label={busy ? "Надсилаю…" : "Надіслати ще раз"}
            icon="upload"
            disabled={busy}
            onPress={() => upload(pending)}
          />
          <Button
            label="Перезняти"
            tone="outline"
            icon="camera"
            onPress={() => {
              setPending(null);
              setError(null);
            }}
          />
        </Screen>
      </>
    );
  }

  /* ---------- Камера ---------- */
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Header
        title="Накладна"
        eyebrow={sent > 0 ? `СКЛАД · ${sent} ЗА ЗАХІД` : "СКЛАД"}
        onBack={() => router.back()}
      />

      <View style={styles.viewport}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

        {/*
          Рамка — не прикраса: найчастіша причина «AI не зміг прочитати» —
          зрізаний край аркуша. Рамка каже, що в кадр має влізти весь аркуш,
          ще до того, як людина натисне кнопку.
        */}
        <View style={styles.frame} pointerEvents="none" />

        {busy && (
          <View style={styles.veil}>
            <ActivityIndicator color={c.brand} size="large" />
            <Text style={styles.veilText}>Читаю накладну…</Text>
            <Text style={styles.veilHint}>
              Довга накладна читається довше — до півхвилини. Не закривайте екран.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.bar}>
        {!!error && !pending && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.hint}>Аркуш повністю в кадрі, без заломів і бліків</Text>
        <Pressable
          onPress={capture}
          disabled={busy}
          style={[styles.shutter, busy && styles.shutterOff]}
          accessibilityLabel="Зняти накладну"
        >
          <Icon name="camera" size={26} color={c.bk} />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, backgroundColor: "#000" },
  frame: {
    position: "absolute",
    top: "6%",
    left: "6%",
    right: "6%",
    bottom: "6%",
    borderWidth: 2,
    borderColor: "rgba(255,214,0,0.8)",
    borderRadius: r.card,
  },
  veil: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: sp.sm,
    paddingHorizontal: sp.pad,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  veilText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  veilHint: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center", lineHeight: 18 },
  bar: {
    alignItems: "center",
    gap: sp.sm,
    paddingVertical: sp.gap,
    backgroundColor: c.bk,
  },
  hint: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
  error: { color: c.badFg, fontSize: 13, paddingHorizontal: sp.pad, textAlign: "center" },
  // 72 px: кнопку тиснуть пальцем, тримаючи аркуш другою рукою.
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.brand,
  },
  shutterOff: { opacity: 0.5 },
});
