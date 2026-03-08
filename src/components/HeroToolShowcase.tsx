"use client";

import { useState, useRef } from "react";

interface ToolItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  video: string; // path to /videos/xxx.mp4
  color: string;
}

const TOOLS: ToolItem[] = [
  {
    id: "grinder",
    label: "Болгарка",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
        <circle cx="28" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <line x1="22" y1="18" x2="8" y2="32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="6" y1="30" x2="10" y2="34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    video: "/videos/grinder.mp4",
    color: "#FF6B35",
  },
  {
    id: "drill",
    label: "Дриль",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
        <rect x="8" y="14" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <line x1="26" y1="21" x2="36" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <rect x="12" y="6" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    video: "/videos/drill.mp4",
    color: "#FFD600",
  },
  {
    id: "saw",
    label: "Пила",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
        <rect x="4" y="18" width="20" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M24 18 L28 14 L30 18 L32 14 L34 18 L36 14 L38 18" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <line x1="14" y1="26" x2="14" y2="34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    video: "/videos/saw.mp4",
    color: "#4ECDC4",
  },
  {
    id: "hammer",
    label: "Молоток",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
        <line x1="12" y1="34" x2="22" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="18" y="6" width="14" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      </svg>
    ),
    video: "/videos/hammer.mp4",
    color: "#A78BFA",
  },
  {
    id: "screwdriver",
    label: "Шуруповерт",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
        <rect x="8" y="12" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" />
        <line x1="24" y1="20" x2="36" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="16" cy="20" r="3" stroke="currentColor" strokeWidth="1.5" />
        <rect x="14" y="4" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    video: "/videos/screwdriver.mp4",
    color: "#34D399",
  },
  {
    id: "welder",
    label: "Зварювання",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
        <path d="M8 28 L20 8 L24 8 L12 28 Z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
        <circle cx="20" cy="14" r="2" fill="currentColor" />
        <path d="M24 20 L30 14 M26 22 L32 16 M28 24 L34 18" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      </svg>
    ),
    video: "/videos/welder.mp4",
    color: "#F472B6",
  },
  {
    id: "planer",
    label: "Рубанок",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
        <path d="M4 24 L36 24 L34 16 L6 16 Z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
        <rect x="14" y="10" width="12" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <line x1="20" y1="24" x2="20" y2="28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    video: "/videos/planer.mp4",
    color: "#FB923C",
  },
  {
    id: "wrench",
    label: "Гайковерт",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
        <line x1="14" y1="34" x2="14" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 14 L8 6 L12 4 M20 14 L20 6 L16 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="8" y1="14" x2="20" y2="14" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    video: "/videos/wrench.mp4",
    color: "#60A5FA",
  },
];

function ToolIcon({ tool }: { tool: ToolItem }) {
  const [hovered, setHovered] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setHovered(true), 80);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setHovered(false);
    setVideoLoaded(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const handleVideoLoaded = () => {
    setVideoLoaded(true);
    videoRef.current?.play().catch(() => {});
  };

  return (
    <div
      className="relative group"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Icon button */}
      <div
        className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center cursor-pointer transition-all duration-300 border"
        style={{
          background: hovered ? `${tool.color}20` : "rgba(255,255,255,0.04)",
          borderColor: hovered ? `${tool.color}60` : "rgba(255,255,255,0.08)",
          color: hovered ? tool.color : "rgba(255,255,255,0.35)",
          transform: hovered ? "scale(1.15)" : "scale(1)",
          boxShadow: hovered ? `0 0 20px ${tool.color}30` : "none",
        }}
      >
        <div className="w-7 h-7 sm:w-8 sm:h-8">{tool.icon}</div>
      </div>

      {/* Label */}
      <p
        className="text-center text-[10px] sm:text-[11px] mt-1.5 font-medium transition-all duration-300 whitespace-nowrap"
        style={{ color: hovered ? tool.color : "rgba(255,255,255,0.3)" }}
      >
        {tool.label}
      </p>

      {/* Video popup */}
      {hovered && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 pointer-events-none"
          style={{ animation: "fadeScaleIn 0.2s ease-out" }}
        >
          <div
            className="w-56 sm:w-64 rounded-xl overflow-hidden border shadow-2xl"
            style={{
              borderColor: `${tool.color}40`,
              boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px ${tool.color}20`,
            }}
          >
            {/* Video */}
            <div className="relative aspect-video bg-[#0A0A0A]">
              <video
                ref={videoRef}
                src={tool.video}
                muted
                loop
                playsInline
                preload="none"
                onLoadedData={handleVideoLoaded}
                className="w-full h-full object-cover"
              />
              {!videoLoaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ background: `${tool.color}25`, color: tool.color }}
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  <span className="text-white/40 text-xs">Завантаження...</span>
                </div>
              )}
            </div>
            {/* Caption */}
            <div
              className="px-3 py-2 text-center text-xs font-semibold text-white"
              style={{ background: `linear-gradient(to right, ${tool.color}15, ${tool.color}25, ${tool.color}15)` }}
            >
              {tool.label} в роботі
            </div>
          </div>
          {/* Arrow */}
          <div className="flex justify-center">
            <div
              className="w-3 h-3 rotate-45 -mt-1.5"
              style={{ background: `${tool.color}25`, borderRight: `1px solid ${tool.color}40`, borderBottom: `1px solid ${tool.color}40` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function HeroToolShowcase() {
  return (
    <div className="flex flex-wrap justify-center gap-4 sm:gap-6 md:gap-8 max-w-2xl mx-auto mt-8 sm:mt-10">
      {TOOLS.map((tool) => (
        <ToolIcon key={tool.id} tool={tool} />
      ))}
    </div>
  );
}
