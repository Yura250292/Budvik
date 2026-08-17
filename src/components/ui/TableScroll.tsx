"use client";

import { useEffect, useRef, useState } from "react";

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
 * -webkit-overflow-scrolling: інерційний скрол в iOS Safari; overscroll-x
 * contain — щоб дотягнувши таблицю до правого краю, не почати гортати
 * сторінку вбік.
 *
 * stickyHeader: у довгій таблиці шапка зникає з очей і колонки цифр стають
 * анонімними (стилі липких th — .table-sticky-head у globals.css). Режимів
 * два, і вибирає між ними замір ширини:
 *
 * - таблиця ВМІЩАЄТЬСЯ (десктоп): обгортка не має overflow узагалі, тож не
 *   є скрол-контекстом — th липнуть до скролу сторінки (main в AdminShell).
 *   Перша версія завжди робила внутрішній скрол, і колесо «застрягало» в
 *   таблиці: сторінку з двома таблицями було не прогорнути.
 * - таблиця ШИРША за екран: без власного скрол-контейнера не обійтись
 *   (overflow-x потрібен), тож скролимо і вертикально всередині, обмеживши
 *   висоту екраном. Вертикальний overscroll НЕ contain: дійшовши до краю
 *   таблиці, колесо продовжує гортати сторінку.
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
  /** Липка шапка: th лишаються видимими при скролі. */
  stickyHeader?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // До заміру (SSR і перший кадр) — false: скрол-контейнер працює всюди,
  // а «сторінковий» режим без потреби лише блимнув би на телефоні.
  const [fits, setFits] = useState(false);

  useEffect(() => {
    if (!stickyHeader) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => setFits(el.clientWidth >= minWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stickyHeader, minWidth]);

  const mode = !stickyHeader
    ? "overflow-x-auto overscroll-x-contain"
    : fits
      ? "table-sticky-head"
      : "table-sticky-head overflow-x-auto overscroll-x-contain max-h-[75vh] overflow-y-auto";

  return (
    <div
      ref={ref}
      className={`table-scroll w-full ${mode} ${className}`}
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
