"use client";

import Link from "next/link";

/** Спільна обгортка вмісту віджета: заголовок, посилання «далі», стани. */
export function WidgetBody({
  title,
  hint,
  href,
  hrefLabel = "Деталі",
  loading,
  error,
  empty,
  emptyText = "Даних за період немає",
  children,
}: {
  title: string;
  hint?: string;
  href?: string;
  hrefLabel?: string;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-bk">{title}</h3>
          {hint && <p className="mt-0.5 truncate text-[11px] text-g500">{hint}</p>}
        </div>
        {href && (
          <Link
            href={href}
            className="flex-shrink-0 text-[12px] font-medium text-g400 transition-colors hover:text-bk"
          >
            {hrefLabel} →
          </Link>
        )}
      </div>

      {error ? (
        <p className="py-4 text-[13px] text-g400">Не вдалося завантажити</p>
      ) : loading ? (
        <div className="flex flex-1 flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-g100" />
          ))}
        </div>
      ) : empty ? (
        <p className="py-6 text-center text-[13px] text-g400">{emptyText}</p>
      ) : (
        <div className="min-h-0 flex-1">{children}</div>
      )}
    </div>
  );
}

/** Число з підписом. Використовується в сітках усередині віджетів. */
export function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const color =
    tone === "good" ? "text-[#1B7F3B]" : tone === "warn" ? "text-[#C77700]" : tone === "bad" ? "text-[#C62828]" : "text-bk";
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] uppercase tracking-wide text-g400">{label}</p>
      <p className={`mt-0.5 truncate text-[17px] font-bold leading-tight tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-g500">{sub}</p>}
    </div>
  );
}

/**
 * Горизонтальна смуга рейтингу.
 *
 * Своя, а не RankBar з ui/Stat: там значення завжди форматується як
 * гроші, а тут поруч живуть і штуки, і години, і відсотки.
 */
export function Bar({
  label,
  value,
  max,
  display,
  suffix,
  color = "var(--color-g400)",
  href,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  suffix?: string;
  color?: string;
  href?: string;
}) {
  const width = max > 0 ? Math.max(1.5, (value / max) * 100) : 0;
  const row = (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="truncate text-[13px] text-bk">{label}</span>
        </span>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-bk">
          {display}
          {suffix && <span className="ml-1 text-[11px] font-normal text-g500">{suffix}</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-g100">
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="block rounded-lg py-1.5 transition-colors hover:bg-g50">
        {row}
      </Link>
    );
  }
  return <div className="py-1.5">{row}</div>;
}
