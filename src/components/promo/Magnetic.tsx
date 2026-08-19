"use client";

import { useRef } from "react";

/*
 * «Магнітна» обгортка: вміст тягнеться до курсора в межах свого блоку
 * і пружно повертається на місце. Класика wow-лендінгів для CTA-кнопок.
 */
export default function Magnetic({ children, className }: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${(dx * 0.25).toFixed(1)}px, ${(dy * 0.25).toFixed(1)}px)`;
  };

  const onLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "";
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`inline-block transition-transform duration-300 ease-spring ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
