/**
 * Горизонтальний скрол для широкої таблиці.
 *
 * На телефоні таблиця з 5+ колонок не влазить у 360px: без цієї обгортки
 * праві колонки просто обрізаються — вони не «за кадром», їх взагалі не
 * дістати, бо скролиться сторінка, а не таблиця.
 *
 * minWidth задає, з якої ширини таблиця починає скролитись замість того,
 * щоб душити колонки в нечитабельні стовпчики по одному слову.
 *
 * -webkit-overflow-scrolling: інерційний скрол в iOS Safari; overscroll
 * contain — щоб дотягнувши таблицю до краю, не почати гортати сторінку.
 */
export function TableScroll({
  children,
  minWidth = 640,
  className = "",
}: {
  children: React.ReactNode;
  /** Ширина, нижче якої таблиця не стискається (px). */
  minWidth?: number;
  className?: string;
}) {
  return (
    <div
      className={`table-scroll w-full overflow-x-auto overscroll-x-contain ${className}`}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {/*
        На друці minWidth знімається через .table-scroll у globals.css:
        інакше рахунок-фактура поїхала б за межі аркуша A4.
      */}
      <div className="table-scroll-inner" style={{ minWidth }}>
        {children}
      </div>
    </div>
  );
}
