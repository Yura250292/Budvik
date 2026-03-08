"use client";

import { useRef, useState } from "react";

interface VideoTool {
  id: string;
  label: string;
  video: string;
  poster?: string;
  accent: string;
}

const CDN = process.env.NEXT_PUBLIC_CDN_URL || "";

const TOOLS: VideoTool[] = [
  {
    id: "grinder",
    label: "Болгарка",
    video: `${CDN}/videos/grinder.mp4`,
    accent: "#FF6B35",
  },
  {
    id: "drill",
    label: "Дриль",
    video: `${CDN}/videos/drill.mp4`,
    accent: "#FFD600",
  },
  {
    id: "saw",
    label: "Циркулярна пила",
    video: `${CDN}/videos/saw.mp4`,
    accent: "#4ECDC4",
  },
  {
    id: "screwdriver",
    label: "Шуруповерт",
    video: `${CDN}/videos/screwdriver.mp4`,
    accent: "#34D399",
  },
  {
    id: "welder",
    label: "Зварювання",
    video: `${CDN}/videos/welder.mp4`,
    accent: "#F472B6",
  },
  {
    id: "hammer",
    label: "Перфоратор",
    video: `${CDN}/videos/hammer.mp4`,
    accent: "#A78BFA",
  },
];

function VideoCard({ tool }: { tool: VideoTool }) {
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
      className="relative rounded-xl overflow-hidden cursor-pointer group"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onTouchStart={handleEnter}
      onTouchEnd={handleLeave}
      style={{
        border: `1px solid ${playing ? `${tool.accent}50` : "rgba(255,255,255,0.08)"}`,
        boxShadow: playing
          ? `0 0 24px ${tool.accent}25, 0 8px 32px rgba(0,0,0,0.4)`
          : "0 2px 8px rgba(0,0,0,0.2)",
        transition: "border-color 0.3s, box-shadow 0.3s, transform 0.3s",
        transform: playing ? "scale(1.03)" : "scale(1)",
      }}
    >
      {/* Video */}
      <div className="aspect-video bg-[#0A0A0A] relative">
        <video
          ref={videoRef}
          src={tool.video}
          poster={tool.poster}
          muted
          loop
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
        />

        {/* Overlay when not playing */}
        <div
          className="absolute inset-0 flex items-center justify-center transition-opacity duration-300"
          style={{ opacity: playing ? 0 : 1, background: "rgba(10,10,10,0.6)" }}
        >
          {/* Play icon */}
          <div
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
            style={{
              background: `${tool.accent}30`,
              border: `2px solid ${tool.accent}60`,
            }}
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6 ml-0.5" fill={tool.accent} viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>

        {/* Playing indicator */}
        {playing && (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 rounded-full px-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: tool.accent }} />
            <span className="text-[10px] text-white/80 font-medium">LIVE</span>
          </div>
        )}

        {/* Error state */}
        {hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0A0A0A]/80">
            <div className="text-center">
              <svg className="w-8 h-8 text-white/20 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <p className="text-white/30 text-[10px]">Скоро буде</p>
            </div>
          </div>
        )}
      </div>

      {/* Label */}
      <div
        className="px-3 py-2 text-center transition-all duration-300"
        style={{
          background: playing
            ? `linear-gradient(to right, ${tool.accent}10, ${tool.accent}20, ${tool.accent}10)`
            : "rgba(255,255,255,0.03)",
        }}
      >
        <span
          className="text-xs sm:text-sm font-semibold transition-colors duration-300"
          style={{ color: playing ? tool.accent : "rgba(255,255,255,0.5)" }}
        >
          {tool.label}
        </span>
      </div>
    </div>
  );
}

export default function HeroToolShowcase() {
  return (
    <div className="mt-8 sm:mt-10 max-w-4xl mx-auto">
      <p className="text-white/30 text-xs sm:text-sm mb-4 font-medium tracking-wide uppercase">
        Наведіть, щоб побачити в дії
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        {TOOLS.map((tool) => (
          <VideoCard key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  );
}
