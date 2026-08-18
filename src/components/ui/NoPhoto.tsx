/**
 * Заглушка картки, якій бракує фото.
 *
 * Раніше на всіх таких товарах стояла та сама сіра іконка «зламане
 * зображення» — на 4 711 позицій у наявності це читалося як несправність
 * сайту, а не як «фото ще немає». Показуємо натомість бренд: він заповнений
 * у 97% товарів і покупцю каже більше, ніж порожнє місце.
 *
 * Свідомо без картинки-заглушки з чужим товаром: краще чесно порожньо, ніж
 * фото іншої моделі (див. розбір фото з cdn.27.ua).
 */

type Size = "sm" | "md" | "lg";

const SIZE = {
  sm: { text: "text-[9px] sm:text-[10px]", pad: "px-1.5", caption: false, rule: "w-4" },
  md: { text: "text-xs sm:text-sm", pad: "px-2", caption: false, rule: "w-6 sm:w-8" },
  lg: { text: "text-lg sm:text-2xl", pad: "px-4", caption: true, rule: "w-10 sm:w-14" },
} as const;

export default function NoPhoto({
  label,
  size = "md",
  className = "",
}: {
  /** Бренд або категорія — те саме, що показує productLabel(). */
  label?: string | null;
  size?: Size;
  className?: string;
}) {
  const s = SIZE[size];

  return (
    <div
      className={`h-full w-full flex flex-col items-center justify-center gap-1 sm:gap-1.5 text-center select-none ${s.pad} ${className}`}
      aria-label={label ? `${label} — фото готуємо` : "Фото готуємо"}
    >
      {label ? (
        <span
          className={`font-bold uppercase tracking-wide text-g400 leading-tight line-clamp-2 ${s.text}`}
        >
          {label}
        </span>
      ) : (
        <svg
          className="h-6 w-6 sm:h-8 sm:w-8 text-g300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.2}
            d="M3 16.5l4.5-4.5a2 2 0 012.8 0l3.2 3.2 2-2a2 2 0 012.8 0L21 16.5M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z"
          />
        </svg>
      )}

      {/* Жовта риска — щоб заглушка читалася як елемент оформлення,
          а не як збій завантаження. */}
      <span className={`h-0.5 rounded-full bg-primary/60 ${s.rule}`} aria-hidden />

      {s.caption && <span className="text-xs text-g400">Фото готуємо</span>}
    </div>
  );
}
