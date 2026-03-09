"use client";

import { useState, useRef } from "react";

interface Props {
  src: string;
  alt: string;
}

export default function ProductImageZoom({ src, alt }: Props) {
  const [zoomed, setZoomed] = useState(false);
  const [lensPos, setLensPos] = useState({ x: 0, y: 0 });
  const [showLens, setShowLens] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setLensPos({ x, y });
    setPanelStyle({
      position: "fixed",
      left: rect.right + 16,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  };

  return (
    <>
      {/* Main image with hover lens */}
      <div
        ref={containerRef}
        className="relative bg-g100 rounded-xl flex items-center justify-center aspect-square overflow-hidden cursor-zoom-in group"
        onMouseEnter={() => setShowLens(true)}
        onMouseLeave={() => setShowLens(false)}
        onMouseMove={handleMouseMove}
        onClick={() => setZoomed(true)}
      >
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-contain p-4"
        />

        {/* Magnifier icon overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none">
          <div className="w-14 h-14 bg-white/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
            <svg className="w-7 h-7 text-g600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
          </div>
        </div>

        {/* Hover highlight area */}
        {showLens && (
          <div
            className="absolute w-36 h-36 border-2 border-primary/60 bg-primary/10 rounded pointer-events-none"
            style={{
              left: `calc(${lensPos.x}% - 72px)`,
              top: `calc(${lensPos.y}% - 72px)`,
            }}
          />
        )}
      </div>

      {/* Zoomed panel — fixed, appears next to image on desktop */}
      {showLens && (
        <div
          className="hidden md:block border-2 border-primary rounded-xl shadow-2xl overflow-hidden bg-white z-[60] pointer-events-none"
          style={{
            ...panelStyle,
            backgroundImage: `url(${src})`,
            backgroundSize: "500%",
            backgroundPosition: `${lensPos.x}% ${lensPos.y}%`,
            backgroundRepeat: "no-repeat",
          }}
        />
      )}

      {/* Fullscreen zoom modal */}
      {zoomed && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center cursor-zoom-out"
          onClick={() => setZoomed(false)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-lg hover:bg-g100 transition z-10"
            onClick={() => setZoomed(false)}
          >
            <svg className="w-6 h-6 text-g600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
