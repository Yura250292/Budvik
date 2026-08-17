/**
 * Скелет каталогу на час серверного рендеру.
 *
 * Без loading.tsx браузер при навігації тримає стару сторінку, доки сервер
 * не догодує нову — і виглядає це як «нічого не відбувається». Скелет дає
 * миттєвий відгук і повторює сітку карток, щоб не стрибала верстка.
 */
export default function CatalogLoading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse px-3 py-4 sm:px-4 sm:py-8">
      <div className="mb-6 h-4 w-40 rounded bg-[#EDEDED]" />
      <div className="mb-2 h-8 w-64 rounded bg-[#EDEDED]" />
      <div className="mb-6 h-4 w-44 rounded bg-[#EDEDED]" />
      <div className="mb-4 h-12 rounded-[10px] bg-[#EDEDED]" />
      <div className="mb-6 h-12 rounded-[10px] bg-[#EDEDED]" />

      <div className="flex flex-col gap-4 sm:gap-6 md:flex-row">
        <aside className="hidden w-72 flex-shrink-0 md:block">
          <div className="h-96 rounded-xl bg-[#EDEDED]" />
        </aside>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 md:gap-6 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-[#EFEFEF] bg-white">
              <div className="h-36 bg-[#F3F3F3] sm:h-48" />
              <div className="space-y-2 p-2.5 sm:p-4">
                <div className="h-3 w-3/4 rounded bg-[#EDEDED]" />
                <div className="h-3 w-1/2 rounded bg-[#EDEDED]" />
                <div className="h-6 w-20 rounded bg-[#EDEDED]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
