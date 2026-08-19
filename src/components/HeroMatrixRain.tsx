"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const ToolMatrixRain = dynamic(() => import("./ToolMatrixRain"), { ssr: false });

/*
 * «Дощ з інструментів» у фоні героя — лише десктоп і лише поки герой
 * видно. rAF-цикл канваса на телефоні жере батарею, тож на екранах
 * вужче md його взагалі не монтуємо; коли герой іде з в'юпорту —
 * розмонтовуємо (cleanup канваса гасить requestAnimationFrame).
 * При prefers-reduced-motion канвас не вмикається зовсім.
 */
export default function HeroMatrixRain() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(desktop.matches && !reduced.matches);
    update();
    desktop.addEventListener("change", update);
    reduced.addEventListener("change", update);
    return () => {
      desktop.removeEventListener("change", update);
      reduced.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    io.observe(host);
    return () => io.disconnect();
  }, [enabled]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden md:block opacity-20"
    >
      {enabled && visible && <ToolMatrixRain />}
    </div>
  );
}
