/** Скелет картки товару — миттєвий відгук замість «завислої» старої сторінки. */
export default function ProductLoading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse px-3 py-4 sm:px-4 sm:py-8">
      <div className="mb-6 h-4 w-64 rounded bg-[#EDEDED]" />
      <div className="grid items-start gap-4 sm:gap-8 md:grid-cols-2">
        <div className="aspect-square rounded-xl bg-[#F3F3F3]" />
        <div>
          <div className="mb-2 h-4 w-28 rounded bg-[#EDEDED]" />
          <div className="mb-2 h-8 w-full rounded bg-[#EDEDED]" />
          <div className="mb-4 h-8 w-2/3 rounded bg-[#EDEDED]" />
          <div className="mb-5 h-44 rounded-xl bg-[#F3F3F3]" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-[#EDEDED]" />
            <div className="h-3 w-5/6 rounded bg-[#EDEDED]" />
            <div className="h-3 w-4/6 rounded bg-[#EDEDED]" />
          </div>
        </div>
      </div>
    </div>
  );
}
