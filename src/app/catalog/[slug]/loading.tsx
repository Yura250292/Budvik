/** Скелет картки товару — миттєвий відгук замість «завислої» старої сторінки.
 * skeleton-shimmer замість animate-pulse; розміри блоків не змінені (CLS). */
export default function ProductLoading() {
  return (
    <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-8">
      <div className="skeleton-shimmer mb-6 h-4 w-64 rounded bg-[#EDEDED]" />
      <div className="grid items-start gap-4 sm:gap-8 md:grid-cols-2">
        <div className="skeleton-shimmer aspect-square rounded-xl bg-[#F3F3F3]" />
        <div>
          <div className="skeleton-shimmer mb-2 h-4 w-28 rounded bg-[#EDEDED]" />
          <div className="skeleton-shimmer mb-2 h-8 w-full rounded bg-[#EDEDED]" />
          <div className="skeleton-shimmer mb-4 h-8 w-2/3 rounded bg-[#EDEDED]" />
          <div className="skeleton-shimmer mb-5 h-44 rounded-xl bg-[#F3F3F3]" />
          <div className="space-y-2">
            <div className="skeleton-shimmer h-3 w-full rounded bg-[#EDEDED]" />
            <div className="skeleton-shimmer h-3 w-5/6 rounded bg-[#EDEDED]" />
            <div className="skeleton-shimmer h-3 w-4/6 rounded bg-[#EDEDED]" />
          </div>
        </div>
      </div>
    </div>
  );
}
