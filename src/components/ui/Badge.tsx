"use client";

import type { ReactNode } from "react";
import { STATUS, type StatusKey } from "@/lib/analytics/colors";

/**
 * Бейдж стану. Колір ніколи не єдиний носій сенсу — усередині завжди текст,
 * тож значення читається і в чорно-білому друку, і при дальтонізмі.
 */
export function Badge({
  status = "neutral",
  children,
  dot = false,
}: {
  status?: StatusKey;
  children: ReactNode;
  dot?: boolean;
}) {
  const c = STATUS[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color: c.fg, backgroundColor: c.bg, borderColor: c.border }}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.mark }} />}
      {children}
    </span>
  );
}

/** Кружечок кольору ряду поруч із його назвою — тотожність у списках і таблицях. */
export function ColorDot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}
