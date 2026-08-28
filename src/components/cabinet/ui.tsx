/**
 * Спільні частини робочого кабінету — за макетом ~/Desktop/pencil-sales.pen.
 *
 * Заради чого. Кожен екран /sales і /driver малював свої картки, рядки й
 * мітки інлайновими стилями: та сама «назва — значення» траплялася в шести
 * файлах із шістьма різними відступами. Правка одного відступу означала шість
 * правок, і після третьої екрани переставали бути схожими один на одного.
 *
 * Дві речі, які тут закріплено назавжди:
 *
 * 1. Фірмовий жовтий — ЛИШЕ на керуванні (головна кнопка, активна вкладка).
 *    Дані фарбуються станом: зелене прийнято, жовтогаряче чекає, червоне не
 *    вийшло. Інакше жовтий на екрані читається то як «натисни», то як «увага».
 *
 * 2. Часові рамки підписані на заголовку групи («за період», «станом на
 *    зараз»), а не вгадуються з контексту: у кабінеті поруч стоять числа за
 *    місяць і числа за цю хвилину, і сплутати їх коштує розмови про гроші.
 *
 * Тут немає бізнес-логіки — усе, що знає про клієнтів, зміни й гроші,
 * лишається на сторінках.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/* ---------- Полотно ---------- */

/** Обгортка вмісту екрана: поля 16, відступ 12 між картками, ширина телефона. */
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto flex max-w-lg flex-col gap-3 px-4 py-4 ${className}`}>{children}</div>
  );
}

/** Група на всю ширину без полів — для списків, що йдуть від краю до краю. */
export function Flush({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-lg">{children}</div>;
}

/** Підпис групи: «КАСА ЗА СЬОГОДНІ», «ДОРОГА В GOOGLE MAPS». */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wide text-cab-t2">{children}</p>
  );
}

/* ---------- Картки ---------- */

const TONE_BORDER = {
  plain: "border-cab-line",
  brand: "border-primary",
  warn: "border-warn-line",
  bad: "border-bad-line",
  ok: "border-ok-line",
} as const;

export function Card({
  children,
  tone = "plain",
  className = "",
  as,
  href,
}: {
  children: ReactNode;
  /** Рамка кольором стану: жовта — треба відповісти, червона — не вийшло. */
  tone?: keyof typeof TONE_BORDER;
  className?: string;
  as?: "section" | "div";
  /** Картка-посилання: уся площа стає ціллю дотику. */
  href?: string;
}) {
  const cls = `rounded-2xl border bg-white p-4 ${TONE_BORDER[tone]} ${className}`;
  if (href) {
    return (
      <Link href={href} className={`${cls} block active:opacity-70`}>
        {children}
      </Link>
    );
  }
  const Tag = as ?? "div";
  return <Tag className={cls}>{children}</Tag>;
}

export function CardTitle({ children, big = false }: { children: ReactNode; big?: boolean }) {
  return (
    <h2 className={big ? "text-[17px] font-bold text-bk" : "text-[15px] font-bold text-bk"}>
      {children}
    </h2>
  );
}

/** Заголовок картки з крапкою стану або іконкою ліворуч і підписом праворуч. */
export function CardHead({
  title,
  dot,
  icon,
  right,
}: {
  title: string;
  dot?: string;
  icon?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {!!dot && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dot }} />}
        {icon}
        <CardTitle big>{title}</CardTitle>
      </div>
      {right}
    </div>
  );
}

const VALUE_TONE = {
  plain: "text-bk",
  ok: "text-ok-fg",
  warn: "text-warn-fg",
  bad: "text-bad-fg",
  muted: "text-cab-t3",
} as const;

/** Рядок «назва — значення». Основна одиниця всіх карток кабінету. */
export function Row({
  label,
  value,
  tone = "plain",
}: {
  label: ReactNode;
  value: ReactNode;
  /** Колір значення: підсвічуємо лише те, що вимагає уваги. */
  tone?: keyof typeof VALUE_TONE;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="min-w-0 text-sm text-cab-t2">{label}</span>
      <span className={`shrink-0 text-right text-sm font-semibold ${VALUE_TONE[tone]}`}>{value}</span>
    </div>
  );
}

/** Пояснення дрібним — те, чого не можна писати в рядку значення. */
export function Note({ children, tone }: { children: ReactNode; tone?: "warn" | "bad" }) {
  const color = tone === "warn" ? "text-warn-fg" : tone === "bad" ? "text-bad-fg" : "text-cab-t3";
  return <p className={`text-xs leading-snug ${color}`}>{children}</p>;
}

export function Body({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-cab-t2">{children}</p>;
}

/* ---------- Числа ---------- */

/**
 * Плитка показника. Крапка ліворуч — колір ряду даних, а не стану: ті самі
 * кольори, що на графіках (src/lib/analytics/colors.ts), щоб плитка й діаграма
 * означали одне й те саме.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  dot,
  href,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  dot?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {!!dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />}
          <span className="truncate text-[13px] font-medium text-cab-t2">{label}</span>
        </span>
        {!!href && <ChevronRight size={16} className="shrink-0 text-cab-t3" />}
      </div>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-semibold leading-tight tracking-tight text-bk">{value}</span>
        {!!unit && <span className="pb-0.5 text-sm font-medium text-cab-t3">{unit}</span>}
      </div>
      {!!hint && <p className="text-xs leading-snug text-cab-t3">{hint}</p>}
    </>
  );

  const cls = "flex flex-col gap-2 rounded-2xl border border-cab-line bg-white p-3.5";
  return href ? (
    <Link href={href} className={`${cls} active:opacity-70`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Дрібна плитка всередині картки: підсумок із трьох-чотирьох чисел. */
export function Tile({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "bad" | "ok";
}) {
  const color = tone === "bad" ? "text-bad-fg" : tone === "ok" ? "text-ok-fg" : "text-bk";
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-xl bg-cab-bg px-3 py-2.5">
      <span className="truncate text-[11px] text-cab-t3">{label}</span>
      <span className="flex items-end gap-1">
        <span className={`text-xl font-bold leading-tight ${color}`}>{value}</span>
        {!!unit && <span className="pb-0.5 text-xs text-cab-t3">{unit}</span>}
      </span>
    </div>
  );
}

export function TileRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}

/* ---------- Мітки ---------- */

const PILL = {
  ok: ["bg-ok-bg", "text-ok-fg", "bg-ok"],
  warn: ["bg-warn-bg", "text-warn-fg", "bg-warn"],
  bad: ["bg-bad-bg", "text-bad-fg", "bg-bad"],
  info: ["bg-info-bg", "text-info-fg", "bg-info"],
  neutral: ["bg-cab-bg", "text-cab-t2", "bg-cab-t3"],
} as const;

/** Капсула стану: крапка + слово. Без крапки — просто мітка на картці. */
export function Pill({
  children,
  tone = "ok",
  dot = false,
}: {
  children: ReactNode;
  tone?: keyof typeof PILL;
  dot?: boolean;
}) {
  const [bg, fg, dotBg] = PILL[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${bg} ${fg}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotBg}`} />}
      {children}
    </span>
  );
}

/** Фільтр-таблетка: період, «мої / всі». Активна — чорна, як і решта керування. */
export function Chip({
  children,
  active = false,
  onClick,
  href,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const cls = `inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
    active ? "border-bk bg-bk text-white" : "border-cab-line bg-white text-cab-t2"
  }`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

/* ---------- Кнопки ---------- */

const BTN = {
  brand: "bg-primary text-bk",
  dark: "bg-bk text-white",
  outline: "border border-[#D1D5DB] bg-white text-bk",
  ok: "bg-ok text-white",
  bad: "bg-bad text-white",
  info: "bg-info text-white",
} as const;

export function Button({
  children,
  tone = "brand",
  href,
  onClick,
  disabled,
  small,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  tone?: keyof typeof BTN;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Другорядна пара кнопок у ряд: нижча й дрібнішим шрифтом. */
  small?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  // 52 px, а не 44: у кнопку цілять пальцем, тримаючи кермо або коробку.
  const cls = `flex items-center justify-center gap-2 rounded-xl text-center font-bold disabled:opacity-55 ${
    small ? "h-11 px-3 text-[13px] font-semibold" : "h-[52px] px-4 text-[15px]"
  } ${BTN[tone]} ${className}`;

  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

/* ---------- Смуга посилань ---------- */

export function LinkList({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-cab-line bg-white px-2.5 py-1">{children}</div>
  );
}

export function LinkRow({
  children,
  icon,
  href,
  onClick,
  tone,
}: {
  children: ReactNode;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
  tone?: "warn" | "bad";
}) {
  const color = tone === "warn" ? "text-warn-fg" : tone === "bad" ? "text-bad-fg" : "text-bk";
  const inner = (
    <>
      <span className={tone === "warn" ? "text-warn-fg" : tone === "bad" ? "text-bad-fg" : "text-cab-t2"}>
        {icon}
      </span>
      <span className={`flex-1 text-sm font-medium ${color}`}>{children}</span>
      <ChevronRight size={16} className="shrink-0 text-cab-t3" />
    </>
  );
  const cls = "flex min-h-11 w-full items-center gap-2.5 px-1 py-1.5 text-left";
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/* ---------- Попередження ---------- */

const CALLOUT = {
  warn: ["bg-warn-bg", "border-warn-line", "text-warn-fg"],
  bad: ["bg-bad-bg", "border-bad-line", "text-bad-fg"],
  ok: ["bg-ok-bg", "border-ok-line", "text-ok-fg"],
  info: ["bg-info-bg", "border-[#BFDBFE]", "text-info-fg"],
} as const;

/**
 * Кольорова врізка з поясненням.
 *
 * Не спливне вікно: те, що тут написано, — не подія, а стан, який триває
 * тижнями («прострочена дебіторка», «точка не уточнена»). Людина мусить
 * прочитати це тоді, коли гортає екран, а не в мить натискання.
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
  tone?: keyof typeof CALLOUT;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  const [bg, border, fg] = CALLOUT[tone];
  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border p-3 ${bg} ${border}`}>
      <div className="flex items-center gap-2">
        {icon}
        <p className={`flex-1 text-sm font-bold ${fg}`}>{title}</p>
      </div>
      {typeof children === "string" ? <Body>{children}</Body> : children}
      {action}
    </div>
  );
}

/* ---------- Рядок списку ---------- */

/**
 * Клієнт, документ, точка маршруту — одна форма на всі списки.
 *
 * Ліворуч ініціали або іконка, посередині назва з підписом, праворуч сума й
 * мітка стану. Саме в такому порядку читають: спершу «хто», потім «скільки».
 */
export function ListRow({
  title,
  subtitle,
  lead,
  value,
  badge,
  href,
  onClick,
  tone = "plain",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  lead?: ReactNode;
  value?: ReactNode;
  badge?: ReactNode;
  href?: string;
  onClick?: () => void;
  tone?: keyof typeof TONE_BORDER;
}) {
  const inner = (
    <>
      {!!lead && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cab-bg text-[13px] font-bold text-cab-t2">
          {lead}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-bk">{title}</span>
        {!!subtitle && <span className="mt-0.5 block truncate text-xs text-cab-t3">{subtitle}</span>}
      </span>
      {(value || badge) && (
        <span className="flex shrink-0 flex-col items-end gap-1">
          {!!value && <span className="text-sm font-semibold text-bk">{value}</span>}
          {badge}
        </span>
      )}
      <ChevronRight size={18} className="shrink-0 text-cab-t3" />
    </>
  );

  const cls = `flex w-full items-center gap-3 rounded-2xl border bg-white px-3.5 py-3 text-left ${TONE_BORDER[tone]}`;
  return href ? (
    <Link href={href} className={`${cls} active:opacity-70`}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
