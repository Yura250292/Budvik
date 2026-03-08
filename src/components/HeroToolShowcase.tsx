"use client";

import { useRef, useState } from "react";

interface VideoTool {
  id: string;
  label: string;
  video: string;
  accent: string;
}

const CDN = process.env.NEXT_PUBLIC_CDN_URL || "";

const TOOLS: VideoTool[] = [
  { id: "grinder", label: "Болгарка", video: `${CDN}/videos/grinder.mp4`, accent: "#FF6B35" },
  { id: "drill", label: "Дриль", video: `${CDN}/videos/drill.mp4`, accent: "#FFD600" },
  { id: "saw", label: "Пила", video: `${CDN}/videos/saw.mp4`, accent: "#4ECDC4" },
  { id: "screwdriver", label: "Шуруповерт", video: `${CDN}/videos/screwdriver.mp4`, accent: "#34D399" },
  { id: "welder", label: "Зварювання", video: `${CDN}/videos/welder.mp4`, accent: "#F472B6" },
  { id: "hammer", label: "Перфоратор", video: `${CDN}/videos/hammer.mp4`, accent: "#A78BFA" },
];

function MiniVideo({ tool, size = 56 }: { tool: VideoTool; size?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleEnter = () => {
    if (hasError) return;
    setPlaying(true);
    videoRef.current?.play().catch(() => setHasError(true));
  };

  const handleLeave = () => {
    setPlaying(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <div
      className="relative cursor-pointer group flex-shrink-0"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onTouchStart={handleEnter}
      onTouchEnd={handleLeave}
    >
      <div
        className="rounded-xl overflow-hidden transition-all duration-300"
        style={{
          width: size,
          height: size,
          border: `2px solid ${playing ? tool.accent : "rgba(255,255,255,0.1)"}`,
          boxShadow: playing ? `0 0 16px ${tool.accent}35` : "none",
          transform: playing ? "scale(1.1)" : "scale(1)",
        }}
      >
        <video
          ref={videoRef}
          src={tool.video}
          muted
          loop
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
        />

        {/* Overlay */}
        <div
          className="absolute inset-0 flex items-center justify-center transition-opacity duration-300 rounded-xl"
          style={{
            opacity: playing ? 0 : 1,
            background: "rgba(10,10,10,0.5)",
          }}
        >
          <svg className="w-4 h-4 ml-0.5 opacity-60" fill={tool.accent} viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>

        {/* Error */}
        {hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0A0A0A]/70 rounded-xl">
            <svg className="w-5 h-5 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
        )}
      </div>

      {/* Label on hover */}
      <p
        className="text-center text-[9px] mt-1 font-medium transition-all duration-300 whitespace-nowrap"
        style={{ color: playing ? tool.accent : "rgba(255,255,255,0.25)", opacity: playing ? 1 : 0.7 }}
      >
        {tool.label}
      </p>
    </div>
  );
}

export default function HeroToolShowcase({ children }: { children: React.ReactNode }) {
  // 3 rows: each row has left video, center content, right video
  // V-shape: row 1 widest gap, row 3 narrowest
  return (
    <div className="mt-6 sm:mt-8 space-y-3 sm:space-y-4">
      {/* Row 1 — widest */}
      <div className="flex items-center justify-center gap-4 sm:gap-8 md:gap-16">
        <MiniVideo tool={TOOLS[0]} size={52} />
        <div className="flex-shrink-0">{children}</div>
        <MiniVideo tool={TOOLS[1]} size={52} />
      </div>

      {/* Row 2 — medium */}
      <div className="flex items-center justify-center gap-3 sm:gap-6 md:gap-10">
        <MiniVideo tool={TOOLS[2]} size={48} />
        <div className="w-40 sm:w-52" />
        <MiniVideo tool={TOOLS[3]} size={48} />
      </div>

      {/* Row 3 — narrowest */}
      <div className="flex items-center justify-center gap-2 sm:gap-4 md:gap-6">
        <MiniVideo tool={TOOLS[4]} size={44} />
        <p className="text-white/20 text-[10px] sm:text-xs font-medium tracking-wider uppercase w-40 sm:w-48 text-center">
          Наведіть, щоб побачити в дії
        </p>
        <MiniVideo tool={TOOLS[5]} size={44} />
      </div>
    </div>
  );
}
