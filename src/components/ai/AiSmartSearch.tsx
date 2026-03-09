"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AiSmartSearch({ currentSearch }: { currentSearch?: string }) {
  const [query, setQuery] = useState(currentSearch || "");
  const router = useRouter();

  const search = () => {
    const q = query.trim();
    if (!q) return;
    const params = new URLSearchParams();
    params.set("search", q);
    router.push(`/catalog?${params.toString()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") search();
  };

  const clear = () => {
    setQuery("");
    router.push("/catalog");
  };

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9E9E9E]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Пошук: 'дриль для бетону', 'болгарка'..."
            className="w-full bg-white border border-[#E0E0E0] rounded-[10px] pl-10 pr-4 py-3 text-[#0A0A0A] placeholder-[#9E9E9E] transition duration-200"
            style={{ height: '48px' }}
          />
        </div>
        <button
          onClick={search}
          className="bg-[#FFD600] text-[#0A0A0A] font-semibold px-6 rounded-[10px] hover:bg-[#FFC400] active:bg-[#FFB800] transition duration-200 flex-shrink-0"
          style={{ height: '48px', minHeight: '48px' }}
        >
          Пошук
        </button>
        {currentSearch && (
          <button
            onClick={clear}
            className="px-4 rounded-[10px] border border-[#E0E0E0] text-[#555] hover:bg-[#F5F5F5] transition duration-200 flex-shrink-0 text-sm"
            style={{ height: '48px', minHeight: '48px' }}
          >
            Скинути
          </button>
        )}
      </div>
    </div>
  );
}
