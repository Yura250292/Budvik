/**
 * Деталі однієї зміни — звідки взялося число, за яке платять.
 *
 * Екран існує не «для повноти». Пробіг зміни складається з двох показань
 * одометра, а коли зміну закрив автомат — з одного показання й здогадки треку.
 * Поки все це лежить у базі й видно лише офісу, будь-яка розмова про зарплату
 * зводиться до «мені так порахували». Тут людина бачить обидва фото приладу,
 * обидва способи міряння й те, ким і коли зміну закрито.
 *
 * Правити тут нічого не можна навмисно: минула зміна — уже підстава для
 * розрахунку, і виправляє її лише офіс. Свою свіжу зміну торговий далі
 * виправляє на головному екрані — підтвердженням або одометром.
 */

import { useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { type ShiftDetail } from "@/api/staff";
import { useShiftDetail, useRefetchOnFocus } from "@/api/staff-queries";
import { formatTime, formatDayShort, formatDayMonth } from "@/lib/format-date";
import { c, r, sp } from "@/ui/tokens";
import {
  Body,
  Card,
  CardHead,
  CardTitle,
  Header,
  Note,
  Row,
  Screen,
} from "@/ui/kit";

export default function ShiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useShiftDetail(id ? String(id) : undefined);
  useRefetchOnFocus(query);

  const data = query.data ?? null;
  const error = query.isError
    ? query.error instanceof Error
      ? query.error.message
      : "Немає зв’язку"
    : null;

  if (query.isPending) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.bk} />
      </View>
    );
  }

  const sh = data?.shift;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Header
        title={sh ? formatDayMonth(sh.startedAt) : "Зміна"}
        eyebrow={sh ? shiftKind(sh) : "Зміна"}
      />

      <Screen>
        {!sh && (
          <Card tone="warn">
            <CardTitle>{error ?? "Зміну не знайдено"}</CardTitle>
            <Body>Деталі завантажаться, щойно з’явиться мережа.</Body>
          </Card>
        )}

        {sh && (
          <>
            {/* Фото приладу — перше, бо це єдиний доказ, який людина може
                перевірити оком, не вірячи нікому на слово. */}
            <View style={s.photos}>
              <Photo
                url={sh.startPhotoUrl}
                value={sh.startOdometer}
                label={`Старт · ${formatTime(sh.startedAt)}`}
                hint="фото з приладу"
              />
              <Photo
                url={sh.endPhotoUrl}
                value={sh.endOdometer}
                label={sh.endedAt ? `Кінець · ${formatTime(sh.endedAt)}` : "Кінець"}
                hint={
                  sh.endPhotoUrl
                    ? "фото з приладу"
                    : sh.endOdometerFromNextShiftAt
                      ? `з ранкового фото ${formatDayShort(sh.endOdometerFromNextShiftAt)}`
                      : "фото немає"
                }
              />
            </View>

            <Card gap={sp.sm}>
              <CardTitle>Пробіг і час</CardTitle>
              <Row
                label="Пробіг за одометром"
                value={sh.distanceKm != null ? `${sh.distanceKm} км` : "—"}
              />
              <Row
                label="За GPS"
                value={sh.gpsDistanceKm != null ? `${dec(sh.gpsDistanceKm)} км` : "—"}
              />
              {sh.odometerToGpsRatio != null && (
                <Row
                  label="Співвідношення"
                  value={`${sh.odometerToGpsRatio.toFixed(2).replace(".", ",")} · ${
                    ratioOk(sh.odometerToGpsRatio) ? "у нормі" : "під питанням"
                  }`}
                  tone={ratioOk(sh.odometerToGpsRatio) ? "good" : "warn"}
                />
              )}
              {sh.afterWorkKm != null && sh.afterWorkKm > 0 && (
                <Row
                  label="Дорога додому (відняті)"
                  value={`${dec(sh.afterWorkKm)} км`}
                  tone="muted"
                />
              )}
              {sh.durationMinutes != null && (
                <Row label="Тривалість" value={duration(sh.durationMinutes)} />
              )}
              {sh.personalKm != null && sh.personalKm > 0 && (
                <Row label="Особисті до старту" value={`${sh.personalKm} км`} tone="muted" />
              )}
              {sh.odometerSuspicious && (
                <Note tone="warn">
                  Одометр під питанням: різниця не схожа на денний пробіг. Виправити його може
                  лише офіс.
                </Note>
              )}
            </Card>

            {/* Хто закрив зміну — окремою карткою, бо саме від цього залежить,
                чи можна вірити її пробігу. */}
            {(sh.closedAutomatically || sh.closedLate) && (
              <Card tone="warn" gap={sp.sm}>
                <CardHead
                  icon="clock-alert"
                  iconColor={c.warn}
                  title={
                    sh.closedAutomatically
                      ? `Закрито автоматично${sh.endedAt ? ` о ${formatTime(sh.endedAt)}` : ""}`
                      : `Закрито заднім числом${sh.endedAt ? ` о ${formatTime(sh.endedAt)}` : ""}`
                  }
                />
                {!!sh.lateCloseSource && (
                  <Row
                    label="Джерело часу"
                    value={SOURCE_LABEL[sh.lateCloseSource] ?? sh.lateCloseSource}
                    tone="warn"
                  />
                )}
                <Row
                  label="Підтверджено"
                  value={
                    sh.confirmedAt
                      ? `${sh.confirmSource === "OFFICE" ? "офісом" : "вами"} ${formatDayShort(sh.confirmedAt)}, ${formatTime(sh.confirmedAt)}`
                      : "ще ні"
                  }
                  tone={sh.confirmedAt ? "good" : "warn"}
                />
                {!!sh.notes && <Note>{sh.notes}</Note>}
              </Card>
            )}

            {/* Схема треку, а не карта: карти в застосунку немає навмисно.
                Питання, на яке вона відповідає, теж не картографічне — «чи
                писався маршрут і чи не рвався він на пів дня». */}
            {data.track.path.length > 1 && (
              <Card gap={sp.sm}>
                <CardTitle>Записаний маршрут</CardTitle>
                <TrackSketch path={data.track.path} />
                <Note>
                  {formatCount(data.track.pointsCount)} · схема лінії, не карта
                  {data.track.afterPointsCount > 0
                    ? ` · після зміни ще ${data.track.afterPointsCount}`
                    : ""}
                </Note>
              </Card>
            )}

            <Note>Виправляти минулі зміни може лише офіс — з них рахується зарплата.</Note>
          </>
        )}
      </Screen>
    </>
  );
}

/* ---------- Фото одометра ---------- */

function Photo({
  url,
  value,
  label,
  hint,
}: {
  url: string | null;
  value: number | null;
  label: string;
  hint: string;
}) {
  return (
    <View style={s.photo}>
      <View style={s.photoBox}>
        {url ? (
          <Image
            source={{ uri: url }}
            style={s.photoImg}
            contentFit="cover"
            transition={120}
            alt={`Одометр: ${label}`}
          />
        ) : (
          /* Фото немає — показуємо саме показання: воно все одно є, просто
             взялося не з кадру. Порожній прямокутник не сказав би нічого. */
          <View style={s.photoEmpty}>
            <Text style={s.photoEmptyValue}>{value != null ? km(value) : "—"}</Text>
          </View>
        )}
      </View>
      <Text style={s.photoLabel}>{label}</Text>
      <Text style={s.photoHint}>{hint}</Text>
      {!!url && value != null && <Text style={s.photoValue}>{km(value)} км</Text>}
    </View>
  );
}

/* ---------- Схема треку ---------- */

/**
 * Лінія маршруту відрізками.
 *
 * Малюємо звичайними View з поворотом, а не картою й не SVG: і
 * react-native-maps, і react-native-svg — нативні модулі, тобто новий APK на
 * кожному планшеті заради картинки, яку дивляться раз на тиждень.
 *
 * Довготу стискаємо на cos(широти): без цього на широті Львова маршрут
 * виглядав би розтягнутим удвічі впоперек, і людина побачила б не свій день.
 */
function TrackSketch({ path }: { path: Array<[number, number]> }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const lats = path.map((p) => p[0]);
  const lngs = path.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);

  const xs = lngs.map((v) => v * kx);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);

  const PAD = 14;
  const points =
    size == null
      ? []
      : (() => {
          const w = size.w - PAD * 2;
          const h = size.h - PAD * 2;
          const scale = Math.min(w / spanX, h / spanY);
          const offX = PAD + (w - spanX * scale) / 2;
          const offY = PAD + (h - spanY * scale) / 2;
          return path.map(([lat, lng]) => ({
            x: offX + (lng * kx - minX) * scale,
            // Північ угорі: широта росте вгору, а координати екрана — вниз.
            y: offY + (maxY - lat) * scale,
          }));
        })();

  return (
    <View
      style={s.sketch}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {points.slice(1).map((p, i) => {
        const a = points[i];
        const len = Math.hypot(p.x - a.x, p.y - a.y);
        if (len < 0.5) return null;
        const angle = Math.atan2(p.y - a.y, p.x - a.x);
        /**
         * Відрізок довший за відстань на два пікселі: сусідні перекриваються,
         * і на зламах не лишається дірок. Без цього лінія на різких поворотах
         * розсипається на пунктир і читається як розрив у записі — тобто як
         * рівно та біда, яку екран і має показувати чесно.
         */
        const draw = len + 2;
        return (
          <View
            key={i}
            style={[
              s.segment,
              {
                width: draw,
                left: (a.x + p.x) / 2 - draw / 2,
                top: (a.y + p.y) / 2 - 1,
                transform: [{ rotate: `${angle}rad` }],
              },
            ]}
          />
        );
      })}
      {points.length > 1 && (
        <>
          <View style={[s.pin, s.pinStart, { left: points[0].x - 6, top: points[0].y - 6 }]} />
          <View
            style={[
              s.pin,
              s.pinEnd,
              {
                left: points[points.length - 1].x - 6,
                top: points[points.length - 1].y - 6,
              },
            ]}
          />
        </>
      )}
    </View>
  );
}

/* ---------- Дрібниці ---------- */

const SOURCE_LABEL: Record<string, string> = {
  AUTO_GAP: "AUTO_GAP · верхня межа",
  AUTO_DEAD: "AUTO_DEAD · остання точка треку",
  AUTO_FORCED: "AUTO_FORCED · приблизний",
  AUTO_GPS: "AUTO_GPS · зупинка в треку",
  GPS: "GPS · зупинка в треку",
  MANUAL: "MANUAL · вказано руками",
  OFFICE: "OFFICE · закрив офіс",
};

function shiftKind(sh: ShiftDetail["shift"]): string {
  if (sh.status === "OPEN") return "Зміна триває";
  if (sh.closedAutomatically) return "Зміна · закрилася сама";
  if (sh.closedLate) return "Зміна · закрита заднім числом";
  return "Зміна · закрита з фото";
}

function ratioOk(ratio: number): boolean {
  return ratio >= 0.9 && ratio <= 1.6;
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} год ${m} хв` : `${m} хв`;
}

function dec(n: number): string {
  return String(n).replace(".", ",");
}

function km(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** «1 284 точки», а не «1284 точок». */
function formatCount(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  const form =
    tens > 10 && tens < 20 ? "точок" : ones === 1 ? "точка" : ones >= 2 && ones <= 4 ? "точки" : "точок";
  return `${km(n)} ${form}`;
}


const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },

  photos: { flexDirection: "row", gap: sp.sm },
  photo: { flex: 1, gap: sp.xs },
  photoBox: { height: 110, borderRadius: r.btn, overflow: "hidden", backgroundColor: "#141414" },
  photoImg: { width: "100%", height: "100%" },
  photoEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  photoEmptyValue: { color: "#9BE7B4", fontSize: 18, fontWeight: "700" },
  photoLabel: { fontSize: 13, fontWeight: "600", color: c.text },
  photoHint: { fontSize: 11, color: c.text3 },
  photoValue: { fontSize: 13, fontWeight: "600", color: c.text2 },

  sketch: {
    height: 150,
    borderRadius: r.btn,
    backgroundColor: c.bg,
    overflow: "hidden",
  },
  segment: { position: "absolute", height: 2, borderRadius: 1, backgroundColor: c.info },
  pin: { position: "absolute", width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: c.surface },
  pinStart: { backgroundColor: c.good },
  pinEnd: { backgroundColor: c.bad },
});
