/**
 * Спільні частини робочих екранів — рівно ті, що є компонентами в макеті
 * (~/Desktop/pencil-sales.pen, ряд «Components»).
 *
 * Заради чого окремий файл: шапка, картка, рядок «назва — значення» і смуга
 * посилань повторюються на кожному з шести екранів. Поки вони жили копіями в
 * StyleSheet кожного екрана, будь-яка правка відступу означала шість правок —
 * і після третьої екрани переставали бути схожими один на одного.
 *
 * Тут немає жодної бізнес-логіки: усе, що знає про зміну, трек чи касу,
 * лишається в екранах.
 */

import type { ReactNode } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type StyleProp,
  type ViewStyle,
  type TextInputProps,
  type RefreshControlProps,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { c, r, sp, H } from "./tokens";
import { Icon, type IconName } from "./Icon";

/* ---------- Шапка ---------- */

/**
 * Темна шапка з жовтою волосинкою вгорі.
 *
 * Своя, а не системна з expo-router: у макеті над назвою екрана стоїть
 * надзаголовок («ЗМІНА З 08:54 · 9,3 ГОД», «КРОК 1 З 1 · ФОТО ПРИЛАДУ»), і
 * саме він відповідає на питання «де я і що зараз буде». Системна шапка
 * другого рядка не має.
 */
export function Header({
  title,
  eyebrow,
  onBack,
  right,
}: {
  title: string;
  eyebrow?: string | null;
  onBack?: (() => void) | null;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const back = onBack === null ? null : (onBack ?? (() => router.back()));

  return (
    <LinearGradient
      colors={[c.bk, c.bkSoft]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <GoldLine />
      <View style={{ height: insets.top }} />
      <View style={s.headerBar}>
        {back && (
          <Pressable style={s.headerBack} onPress={back} hitSlop={8}>
            <Icon name="chevron-left" size={22} color={c.onDark} />
          </Pressable>
        )}
        <View style={s.headerTitles}>
          {!!eyebrow && <Text style={s.headerEyebrow}>{eyebrow.toUpperCase()}</Text>}
          <Text style={s.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {right}
      </View>
    </LinearGradient>
  );
}

/** Жовта волосинка по верхньому краю — єдина мітка бренду на робочих екранах. */
export function GoldLine() {
  return (
    <LinearGradient
      colors={["#FFD60000", c.brand, "#FFD60000"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{ height: 2 }}
    />
  );
}

/* ---------- Полотно ---------- */

/** Екран: сіре полотно, поля 16 і відступ 12 між картками. */
export function Screen({
  children,
  scrollRef,
  refreshControl,
  padded = true,
}: {
  children: ReactNode;
  scrollRef?: React.Ref<ScrollView>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Списки на всю ширину (точки маршруту) полів не мають. */
  padded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[
        padded ? s.page : s.pageFlush,
        { paddingBottom: 24 + insets.bottom },
      ]}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/* ---------- Картки ---------- */

export function Card({
  children,
  tone = "plain",
  style,
  gap = sp.sm,
}: {
  children: ReactNode;
  /** Рамка кольором стану: жовта — треба відповісти, червона — не вийшло. */
  tone?: "plain" | "brand" | "warn" | "bad";
  style?: StyleProp<ViewStyle>;
  gap?: number;
}) {
  const border =
    tone === "brand" ? c.brand : tone === "warn" ? c.warnLine : tone === "bad" ? c.badLine : c.line;
  return <View style={[s.card, { borderColor: border, gap }, style]}>{children}</View>;
}

export function CardTitle({ children, big = false }: { children: ReactNode; big?: boolean }) {
  return <Text style={big ? s.cardTitleBig : s.cardTitle}>{children}</Text>;
}

/** Заголовок картки з іконкою або крапкою стану ліворуч і підписом праворуч. */
export function CardHead({
  title,
  icon,
  iconColor,
  dot,
  right,
}: {
  title: string;
  icon?: IconName;
  iconColor?: string;
  dot?: string;
  right?: ReactNode;
}) {
  return (
    <View style={s.cardHead}>
      <View style={s.cardHeadLeft}>
        {!!dot && <View style={[s.dot, { backgroundColor: dot }]} />}
        {!!icon && <Icon name={icon} size={20} color={iconColor ?? c.text2} />}
        <Text style={s.cardTitleBig}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

/** Рядок «назва — значення». Основна одиниця всіх робочих карток. */
export function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  /** Колір значення: підсвічуємо лише те, що вимагає уваги. */
  tone?: "good" | "warn" | "bad" | "muted";
}) {
  const color =
    tone === "good" ? c.goodFg
    : tone === "warn" ? c.warnFg
    : tone === "bad" ? c.badFg
    : tone === "muted" ? c.text3
    : c.text;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, { color }]}>{value}</Text>
    </View>
  );
}

export function Note({ children, tone }: { children: ReactNode; tone?: "bad" | "warn" }) {
  const color = tone === "bad" ? c.badFg : tone === "warn" ? c.warnFg : c.text3;
  return <Text style={[s.note, { color }]}>{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={s.body}>{children}</Text>;
}

/* ---------- Великі числа ---------- */

/**
 * Плитка з числом. Три-чотири в ряд, кожна тягнеться порівну.
 *
 * Число окремо від одиниці навмисно: «112,4 км» одним рядком читається як
 * текст, а розділене — як показник, який видно скоса.
 */
export function StatTile({
  label,
  value,
  unit,
  tone,
  compact,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "bad";
  /** Чотири плитки в ряд: інакше підпис переноситься, а одиниця зрізається. */
  compact?: boolean;
}) {
  return (
    <View style={[s.tile, compact && s.tileCompact]}>
      <Text style={[s.tileLabel, compact && s.tileLabelCompact]} numberOfLines={compact ? 1 : 2}>
        {label}
      </Text>
      <View style={s.tileValueRow}>
        <Text
          style={[s.tileValue, compact && s.tileValueCompact, tone === "bad" && { color: c.badFg }]}
          numberOfLines={1}
        >
          {value}
        </Text>
        {!!unit && <Text style={[s.tileUnit, compact && s.tileUnitCompact]}>{unit}</Text>}
      </View>
    </View>
  );
}

export function TileRow({ children }: { children: ReactNode }) {
  return <View style={s.tileRow}>{children}</View>;
}

/* ---------- Мітки ---------- */

/** Капсула стану: крапка + слово. Без крапки — просто мітка на картці. */
export function Pill({
  label,
  tone = "good",
  dot = true,
}: {
  label: string;
  tone?: "good" | "warn" | "bad" | "info" | "neutral";
  dot?: boolean;
}) {
  const map = {
    good: [c.goodBg, c.goodFg, c.good],
    warn: [c.warnBg, c.warnFg, c.warn],
    bad: [c.badBg, c.badFg, c.bad],
    info: [c.infoBg, c.infoFg, c.info],
    neutral: [c.bg, c.text2, c.text3],
  } as const;
  const [bg, fg, dotColor] = map[tone];
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      {dot && <View style={[s.pillDot, { backgroundColor: dotColor }]} />}
      <Text style={[s.pillLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

/* ---------- Кнопки ---------- */

export type ButtonTone = "brand" | "dark" | "outline" | "good" | "bad" | "info";

export function Button({
  label,
  onPress,
  tone = "brand",
  icon,
  disabled,
  small,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  icon?: IconName;
  disabled?: boolean;
  /** Другорядна пара кнопок у ряд: нижча й дрібнішим шрифтом. */
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const skin: Record<ButtonTone, { bg: string; fg: string; border?: string }> = {
    brand: { bg: c.brand, fg: c.bk },
    dark: { bg: c.bk, fg: c.onDark },
    outline: { bg: c.surface, fg: c.text, border: c.inputLine },
    good: { bg: c.good, fg: c.onDark },
    bad: { bg: c.bad, fg: c.onDark },
    info: { bg: c.info, fg: c.onDark },
  };
  const sk = skin[tone];
  // Іконка на темній кнопці — жовта: єдина мітка бренду там, де фон чорний.
  const iconColor = tone === "dark" ? c.brand : sk.fg;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        {
          backgroundColor: sk.bg,
          height: small ? H.secondary : H.primary,
          borderWidth: sk.border ? 1 : 0,
          borderColor: sk.border,
          opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {!!icon && <Icon name={icon} size={small ? 16 : 18} color={iconColor} />}
      {/* Два рядки, а не один: підпис на кнопці містить суму («Приїхав, забрав
          4 100 ₴»), і обрізане многоточчям число гірше за перенос — водій має
          бачити, скільки саме він підтверджує. */}
      <Text
        style={[
          s.btnLabel,
          { color: sk.fg, fontSize: small ? 12 : 15, fontWeight: small ? "600" : "700" },
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Дві кнопки в ряд, кожна на пів ширини. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={s.btnRow}>{children}</View>;
}

/** Текстове посилання під кнопкою — дія, яку не варто пропонувати нарівні. */
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.textLink} hitSlop={6}>
      <Text style={s.textLinkLabel}>{label}</Text>
    </Pressable>
  );
}

/* ---------- Смуга посилань ---------- */

export function LinkList({ children }: { children: ReactNode }) {
  return <View style={s.linkList}>{children}</View>;
}

export function LinkRow({
  label,
  icon,
  onPress,
  tone,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  tone?: "warn" | "bad";
}) {
  const color = tone === "warn" ? c.warnFg : tone === "bad" ? c.badFg : c.text;
  const iconColor = tone === "warn" ? c.warnFg : tone === "bad" ? c.badFg : c.text2;
  return (
    <Pressable style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.6 }]} onPress={onPress}>
      <Icon name={icon} size={18} color={iconColor} />
      <Text style={[s.linkLabel, { color }]}>{label}</Text>
      <Icon name="chevron-right" size={16} color={c.text3} />
    </Pressable>
  );
}

/* ---------- Попередження ---------- */

/**
 * Кольорова врізка з поясненням і, за потреби, кнопкою.
 *
 * Не Alert системи: те, що тут пишеться, людина мусить прочитати не в мить
 * натискання, а тоді, коли гортає екран — «система присипляє застосунок» не
 * подія, а стан, який триває тижнями.
 */
export function Callout({
  title,
  children,
  tone = "warn",
  icon,
  action,
}: {
  title: string;
  children?: ReactNode;
  tone?: "warn" | "bad" | "good" | "info";
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}) {
  const map = {
    warn: [c.warnBg, c.warnLine, c.warn, c.warnFg],
    bad: [c.badBg, c.badLine, c.bad, c.badFg],
    good: [c.goodBg, c.goodLine, c.good, c.goodFg],
    info: [c.infoBg, "#BFDBFE", c.info, c.infoFg],
  } as const;
  const [bg, border, iconColor, fg] = map[tone];
  return (
    <View style={[s.callout, { backgroundColor: bg, borderColor: border }]}>
      <View style={s.calloutHead}>
        {!!icon && <Icon name={icon} size={18} color={iconColor} />}
        <Text style={[s.calloutTitle, { color: fg }]}>{title}</Text>
      </View>
      {typeof children === "string" ? <Text style={s.body}>{children}</Text> : children}
      {!!action && (
        <Pressable
          style={[s.calloutBtn, { borderColor: border }]}
          onPress={action.onPress}
        >
          <Text style={[s.calloutBtnLabel, { color: fg }]}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ---------- Поля вводу ---------- */

/**
 * Число в полі — велике й моноширинне за розміром: одометр і суму читають
 * уголос, звіряючи з приладом або з купюрами в руці.
 */
export function BigInput({
  unit,
  style,
  ...props
}: TextInputProps & { unit?: string }) {
  return (
    <View style={s.bigInput}>
      <TextInput
        placeholderTextColor={c.text3}
        {...props}
        style={[s.bigInputText, style]}
      />
      {!!unit && <Text style={s.bigInputUnit}>{unit}</Text>}
    </View>
  );
}

export function Field({ style, ...props }: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={c.text3}
      {...props}
      style={[s.field, style]}
    />
  );
}

/** Підпис групи на всю ширину: «КАСА ЗА СЬОГОДНІ», «ДОРОГА В GOOGLE MAPS». */
export function Eyebrow({ children }: { children: string }) {
  return <Text style={s.eyebrow}>{children.toUpperCase()}</Text>;
}

const s = StyleSheet.create({
  page: { padding: sp.pad, gap: sp.gap, backgroundColor: c.bg, flexGrow: 1 },
  pageFlush: { paddingTop: sp.sm, gap: sp.sm, backgroundColor: c.bg, flexGrow: 1 },

  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: sp.gap,
    paddingTop: sp.sm,
    paddingHorizontal: sp.pad,
    paddingBottom: 14,
  },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: r.btn,
    backgroundColor: c.onDarkFill,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitles: { flex: 1, gap: 2 },
  headerEyebrow: { color: c.onDarkFaint, fontSize: 11, fontWeight: "500", letterSpacing: 0.4 },
  headerTitle: { color: c.onDark, fontSize: 20, fontWeight: "700" },

  card: {
    backgroundColor: c.surface,
    borderRadius: r.card,
    borderWidth: 1,
    padding: sp.pad,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: c.text },
  cardTitleBig: { fontSize: 17, fontWeight: "700", color: c.text },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp.sm },
  cardHeadLeft: { flexDirection: "row", alignItems: "center", gap: sp.sm, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp.sm },
  rowLabel: { fontSize: 14, color: c.text2, flexShrink: 1 },
  rowValue: { fontSize: 14, fontWeight: "600", textAlign: "right" },

  note: { fontSize: 12, lineHeight: 17, color: c.text3 },
  body: { fontSize: 13, lineHeight: 19, color: c.text2 },

  tileRow: { flexDirection: "row", gap: sp.sm },
  tile: { flex: 1, backgroundColor: c.bg, borderRadius: r.btn, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  tileCompact: { paddingHorizontal: 8 },
  tileLabel: { fontSize: 11, color: c.text3 },
  tileLabelCompact: { fontSize: 10 },
  tileValueRow: { flexDirection: "row", alignItems: "flex-end", gap: 3 },
  tileValue: { fontSize: 20, fontWeight: "700", color: c.text, lineHeight: 22 },
  tileValueCompact: { fontSize: 18, lineHeight: 20 },
  tileUnit: { fontSize: 12, color: c.text3, lineHeight: 16 },
  tileUnitCompact: { fontSize: 10, lineHeight: 14 },

  pill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: r.chip, paddingVertical: 3, paddingHorizontal: 8 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillLabel: { fontSize: 12, fontWeight: "600" },

  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: sp.sm,
    borderRadius: r.btn,
    paddingHorizontal: 12,
  },
  btnLabel: { textAlign: "center", flexShrink: 1 },
  btnRow: { flexDirection: "row", gap: sp.sm },

  textLink: { paddingVertical: sp.sm, alignItems: "center" },
  textLinkLabel: { color: c.text2, fontSize: 13, textAlign: "center" },

  linkList: {
    backgroundColor: c.surface,
    borderRadius: r.card,
    borderWidth: 1,
    borderColor: c.line,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  // minHeight, а не height: довгі підписи («Не обмежувати батарею для
  // застосунку») переносяться на два рядки й у фіксовану висоту не влазять.
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: H.link,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  linkLabel: { flex: 1, fontSize: 14, fontWeight: "500" },

  callout: { borderRadius: r.btn, borderWidth: 1, padding: sp.gap, gap: sp.xs },
  calloutHead: { flexDirection: "row", alignItems: "center", gap: sp.sm },
  calloutTitle: { fontSize: 14, fontWeight: "700", flex: 1 },
  calloutBtn: {
    height: 40,
    borderRadius: r.sm,
    borderWidth: 1,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    alignSelf: "flex-start",
  },
  calloutBtnLabel: { fontSize: 13, fontWeight: "600" },

  bigInput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: H.field,
    borderRadius: r.btn,
    borderWidth: 1,
    borderColor: c.inputLine,
    backgroundColor: c.surface,
    paddingHorizontal: 14,
  },
  bigInputText: { flex: 1, fontSize: 22, fontWeight: "700", color: c.text, padding: 0 },
  bigInputUnit: { fontSize: 14, color: c.text3 },

  field: {
    height: 46,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.inputLine,
    backgroundColor: c.surface,
    paddingHorizontal: 12,
    // 16 px і не менше: інакше Android збільшує масштаб під час вводу.
    fontSize: 16,
    color: c.text,
  },

  eyebrow: { fontSize: 11, fontWeight: "700", color: c.text2, letterSpacing: 0.4 },
});
