"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/utils";

interface Suggestion {
  name: string;
  slug: string;
  price: number;
  image?: string | null;
  stock: number;
  category: { name: string };
}

export default function AiSmartSearch({ currentSearch }: { currentSearch?: string }) {
  const [query, setQuery] = useState(currentSearch || "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);

  const search = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    setShowSuggestions(false);
    const params = new URLSearchParams();
    params.set("search", q);
    router.push(`/catalog?${params.toString()}`);
  }, [query, router]);

  // Fetch suggestions with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/suggest?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
        setSelectedIndex(-1);
      } catch {
        // silently fail
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        router.push(`/catalog/${suggestions[selectedIndex].slug}`);
        setShowSuggestions(false);
      } else {
        search();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const clear = () => {
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
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
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="Пошук: 'дриль для бетону', 'болгарка'..."
            className="w-full bg-white border border-[#E0E0E0] rounded-[10px] pl-10 pr-4 py-3 text-[#0A0A0A] placeholder-[#9E9E9E] transition duration-200"
            style={{ height: '48px' }}
            autoComplete="off"
          />

          {/* Suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E0E0E0] rounded-xl shadow-lg z-50 overflow-hidden max-h-[400px] overflow-y-auto">
              {suggestions.map((item, i) => (
                <Link
                  key={item.slug}
                  href={`/catalog/${item.slug}`}
                  onClick={() => setShowSuggestions(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 transition duration-150 ${
                    i === selectedIndex
                      ? "bg-[#FFD600]/10"
                      : "hover:bg-[#FAFAFA]"
                  } ${i < suggestions.length - 1 ? "border-b border-[#F0F0F0]" : ""}`}
                >
                  {/* Product image */}
                  <div className="relative w-10 h-10 flex-shrink-0 rounded-lg bg-[#F5F5F5] flex items-center justify-center overflow-hidden">
                    {item.image ? (
                      <Image src={item.image} alt="" fill className="object-contain" sizes="40px" />
                    ) : (
                      <svg className="w-5 h-5 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                      </svg>
                    )}
                  </div>
                  {/* Product info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0A0A0A] truncate">{item.name}</p>
                    <p className="text-xs text-[#9E9E9E]">{item.category.name}</p>
                  </div>
                  {/* Price */}
                  <div className="flex-shrink-0 text-right">
                    <span className={`text-sm font-bold ${item.stock > 0 ? "text-[#0A0A0A]" : "text-[#9E9E9E]"}`}>
                      {formatPrice(item.price)}
                    </span>
                    {item.stock <= 0 && (
                      <p className="text-[10px] text-red-400">Немає</p>
                    )}
                  </div>
                </Link>
              ))}

              {/* "Show all results" button */}
              <button
                onClick={search}
                className="w-full px-3 py-2.5 text-sm text-[#555] hover:bg-[#FAFAFA] transition font-medium text-center border-t border-[#E0E0E0]"
              >
                Показати всі результати для &quot;{query.trim()}&quot;
              </button>
            </div>
          )}
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
