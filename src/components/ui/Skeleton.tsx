/**
 * Скелетони завантаження. Резервують висоту наперед, щоб контент не
 * стрибав, коли приходить відповідь.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-g200 motion-reduce:animate-none ${className}`} />;
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-[var(--radius-card)] border border-g200 bg-white p-4 shadow-[var(--shadow-card)]">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

export function CardSkeleton({ rows = 5, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-g200 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
      {title && <Skeleton className="mb-4 h-4 w-40" />}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-1.5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white shadow-[var(--shadow-card)]">
      <div className="border-b border-g200 bg-g50 px-4 py-3">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="divide-y divide-g100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={`h-3 ${c === 0 ? "w-40" : "w-16"}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
