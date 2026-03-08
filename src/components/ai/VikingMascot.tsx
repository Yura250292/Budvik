"use client";

interface VikingMascotProps {
  size?: number;
  className?: string;
  variant?: "default" | "helmet" | "wink" | "thinking";
  animated?: boolean;
}

export default function VikingMascot({
  size = 48,
  className = "",
  variant = "default",
  animated = false,
}: VikingMascotProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${animated ? "viking-float" : ""} ${className}`}
    >
      {/* Viking Helmet */}
      <path
        d="M30 52C30 35 42 20 60 20C78 20 90 35 90 52V58H30V52Z"
        fill="#FFD600"
        stroke="#0A0A0A"
        strokeWidth="2.5"
      />
      {/* Helmet center ridge */}
      <path
        d="M60 18V58"
        stroke="#0A0A0A"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Helmet horizontal band */}
      <path
        d="M30 48H90"
        stroke="#0A0A0A"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Helmet rivets */}
      <circle cx="40" cy="48" r="2.5" fill="#0A0A0A" />
      <circle cx="50" cy="48" r="2.5" fill="#0A0A0A" />
      <circle cx="70" cy="48" r="2.5" fill="#0A0A0A" />
      <circle cx="80" cy="48" r="2.5" fill="#0A0A0A" />

      {/* Left horn */}
      <path
        d="M30 44C24 36 14 28 8 22"
        stroke="#FFD600"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M30 44C24 36 14 28 8 22"
        stroke="#0A0A0A"
        strokeWidth="8"
        strokeLinecap="round"
        fill="none"
        opacity="0.15"
      />
      {/* Right horn */}
      <path
        d="M90 44C96 36 106 28 112 22"
        stroke="#FFD600"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M90 44C96 36 106 28 112 22"
        stroke="#0A0A0A"
        strokeWidth="8"
        strokeLinecap="round"
        fill="none"
        opacity="0.15"
      />

      {/* Face */}
      <rect
        x="32"
        y="58"
        width="56"
        height="34"
        rx="6"
        fill="#FFC870"
        stroke="#0A0A0A"
        strokeWidth="2"
      />

      {/* Nose guard (viking style) */}
      <path
        d="M56 56V68"
        stroke="#FFD600"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M64 56V68"
        stroke="#FFD600"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M55 56H65"
        stroke="#FFD600"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Eyes */}
      {variant === "wink" ? (
        <>
          {/* Left eye open */}
          <ellipse cx="44" cy="68" rx="4" ry="4.5" fill="#0A0A0A" />
          <circle cx="45.5" cy="66.5" r="1.5" fill="white" />
          {/* Right eye winking */}
          <path
            d="M72 68C74 66 78 66 80 68"
            stroke="#0A0A0A"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      ) : variant === "thinking" ? (
        <>
          {/* Eyes looking up */}
          <ellipse cx="44" cy="66" rx="4" ry="4.5" fill="#0A0A0A" />
          <circle cx="45" cy="64.5" r="1.5" fill="white" />
          <ellipse cx="76" cy="66" rx="4" ry="4.5" fill="#0A0A0A" />
          <circle cx="77" cy="64.5" r="1.5" fill="white" />
        </>
      ) : (
        <>
          {/* Normal eyes */}
          <ellipse cx="44" cy="68" rx="4" ry="4.5" fill="#0A0A0A" />
          <circle cx="45.5" cy="66.5" r="1.5" fill="white" />
          <ellipse cx="76" cy="68" rx="4" ry="4.5" fill="#0A0A0A" />
          <circle cx="77.5" cy="66.5" r="1.5" fill="white" />
        </>
      )}

      {/* Beard */}
      <path
        d="M34 84C34 84 38 100 60 100C82 100 86 84 86 84"
        fill="#C8841D"
        stroke="#0A0A0A"
        strokeWidth="2"
      />
      {/* Beard detail strands */}
      <path d="M44 86V96" stroke="#A06A10" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M52 87V98" stroke="#A06A10" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M60 87V100" stroke="#A06A10" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M68 87V98" stroke="#A06A10" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M76 86V96" stroke="#A06A10" strokeWidth="1.5" strokeLinecap="round" />

      {/* Mouth */}
      {variant === "thinking" ? (
        <circle cx="60" cy="80" r="3" fill="#0A0A0A" opacity="0.6" />
      ) : (
        <path
          d="M52 79C54 83 66 83 68 79"
          stroke="#0A0A0A"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      )}

      {/* AI glow effect */}
      <circle cx="60" cy="60" r="50" fill="none" stroke="#FFD600" strokeWidth="1" opacity="0.2" />
    </svg>
  );
}
