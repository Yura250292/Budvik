"use client";

import { usePathname } from "next/navigation";

export default function TestBanner() {
  const pathname = usePathname();
  if (pathname?.startsWith("/sales")) return null;

  return (
    <div className="w-full bg-[#0A0A0A] border-y border-[#FFD600]/30 overflow-hidden z-40 relative">
      <div className="flex animate-marquee whitespace-nowrap py-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <span key={i} className="mx-8 text-sm font-semibold tracking-wide">
            <span className="text-[#FFD600]">&#9888;</span>
            <span className="text-white/90 mx-2">ТЕСТОВА ВЕРСІЯ — не робіть замовлення, сайт у процесі тестування!</span>
            <span className="text-[#FFD600]">&#9888;</span>
          </span>
        ))}
      </div>
    </div>
  );
}
