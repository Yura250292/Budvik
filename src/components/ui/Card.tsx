/**
 * Базові UI-примітиви адмін-аналітики.
 *
 * До цього кожна сторінка звіту тримала власну константу CARD з inline-
 * стилями, скопійовану від сусідів. Тут вони зведені в одне місце й
 * прив'язані до токенів із globals.css.
 */

import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-g200 bg-white shadow-[var(--shadow-card)] ${
        padded ? "p-4 sm:p-5" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-bk">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-g500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/** Порожній стан: пояснює, чому даних немає, а не просто «Немає даних». */
export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {icon && <div className="text-g400">{icon}</div>}
      <p className="text-sm font-medium text-g600">{title}</p>
      {hint && <p className="max-w-sm text-xs text-g500">{hint}</p>}
    </div>
  );
}
