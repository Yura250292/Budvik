"use client";

import { useEffect, useRef } from "react";

/*
 * Обгортка, що віддає позицію курсора в CSS-змінні --mx/--my (-0.5…0.5).
 * Дочірні шари з класами mouse-layer / cursor-glow зсуваються і світяться
 * за мишкою без жодного re-render — усе через style.setProperty у rAF.
 * На тачі та при reduced-motion слухач не вішається зовсім.
 */
export default function MouseFx({ children, className }: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
        el.style.setProperty("--my", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
      });
    };
    el.addEventListener("mousemove", onMove);
    return () => {
      el.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
