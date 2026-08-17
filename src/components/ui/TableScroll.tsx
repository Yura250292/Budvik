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
 *
 * stickyHeader: у довгій таблиці шапка зникає з очей і колонки цифр стають
 * анонімними. Липнути до скролу сторінки th не можуть — overflow-x робить
 * цю обгортку найближчим скрол-контекстом, і sticky рахується від неї.
 * Тому вертикальний скрол переносимо сюди ж: контейнер обмежується висотою
 * екрана, а th прилипають до його верху (стилі — .table-sticky-head у
 * globals.css).
 */
export function TableScroll({
  children,
  minWidth = 640,
  stickyHeader = false,
  className = "",
}: {
  children: React.ReactNode;
  /** Ширина, нижче якої таблиця не стискається (px). */
  minWidth?: number;
  /** Липка шапка: таблиця скролиться всередині, th лишаються зверху. */
  stickyHeader?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`table-scroll w-full overflow-x-auto ${
        stickyHeader
          ? "table-sticky-head max-h-[75vh] overflow-y-auto overscroll-contain"
          : "overscroll-x-contain"
      } ${className}`}
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
