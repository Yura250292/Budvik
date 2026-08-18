"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSuggest } from "@/components/search/useSuggest";
import SuggestList from "@/components/search/SuggestList";

/**
 * Велике поле пошуку на сторінці каталогу.
 *
 * Логіка підказок спільна з полем у шапці й мобільним оверлеєм
 * (useSuggest + SuggestList) — тут лишилась тільки верстка вітрини.
 */
export default function AiSmartSearch({ currentSearch }: { currentSearch?: string }) {
  const [query, setQuery] = useState(currentSearch || "");
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { items, open, setOpen, active, onKeyDown } = useSuggest(query);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [setOpen]);

  const search = () => {
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    router.push(`/catalog?search=${encodeURIComponent(q)}`);
  };

  const clear = () => {
    setQuery("");
    setOpen(false);
    router.push("/catalog");
  };

  return (
    <div className="w-full" ref={wrapperRef}>
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9E9E9E] z-10"
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
            onKeyDown={(e) => {
              const slug = onKeyDown(e);
              if (slug) router.push(`/catalog/${slug}`);
              else if (e.key === "Enter") search();
            }}
            onFocus={() => items.length > 0 && setOpen(true)}
            placeholder="Назва або артикул: 'дриль для бетону', 'GR-30030'..."
            className="w-full bg-white border border-[#E0E0E0] rounded-[10px] pl-10 pr-4 py-3 text-[#0A0A0A] placeholder-[#9E9E9E] transition duration-200"
            style={{ height: "48px" }}
            autoComplete="off"
          />

          {open && items.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E0E0E0] rounded-xl shadow-lg z-50 overflow-hidden max-h-[400px] overflow-y-auto">
              <SuggestList
                items={items}
                active={active}
                query={query}
                onPick={() => setOpen(false)}
                onShowAll={search}
              />
            </div>
          )}
        </div>
        <button
          onClick={search}
          className="bg-[#FFD600] text-[#0A0A0A] font-semibold px-6 rounded-[10px] hover:bg-[#FFC400] active:bg-[#FFB800] transition duration-200 flex-shrink-0"
          style={{ height: "48px", minHeight: "48px" }}
        >
          Пошук
        </button>
        {currentSearch && (
          <button
            onClick={clear}
            className="px-4 rounded-[10px] border border-[#E0E0E0] text-[#555] hover:bg-[#F5F5F5] transition duration-200 flex-shrink-0 text-sm"
            style={{ height: "48px", minHeight: "48px" }}
          >
            Скинути
          </button>
        )}
      </div>
    </div>
  );
}
