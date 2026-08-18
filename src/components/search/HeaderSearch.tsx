"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSuggest } from "./useSuggest";
import SuggestList from "./SuggestList";

/**
 * Пошук у шапці для широких екранів.
 *
 * До цього поле пошуку існувало тільки на сторінці каталогу: щоб знайти
 * товар із головної чи з картки, треба було спершу здогадатись перейти в
 * каталог. Для магазину на 49 тис. позицій це головний спосіб навігації.
 */
export default function HeaderSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const { items, open, setOpen, active, onKeyDown } = useSuggest(query);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [setOpen]);

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    router.push(`/catalog?search=${encodeURIComponent(q)}`);
  };

  return (
    <div ref={wrapper} className="relative flex-1 max-w-md">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[#9E9E9E]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          const slug = onKeyDown(e);
          if (slug) router.push(`/catalog/${slug}`);
          else if (e.key === "Enter") submit();
        }}
        placeholder="Пошук: «дриль для бетону», «GR-30030»…"
        aria-label="Пошук товарів"
        autoComplete="off"
        className="h-9 w-full rounded-[10px] border border-white/15 bg-white/10 pl-9 pr-3 text-sm text-white placeholder-white/45 transition focus:border-[#FFD600] focus:bg-white focus:text-[#0A0A0A] focus:placeholder-[#9E9E9E] focus:outline-none"
      />

      {open && items.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[420px] overflow-y-auto overflow-hidden rounded-xl border border-[#E0E0E0] bg-white shadow-lg">
          <SuggestList
            items={items}
            active={active}
            query={query}
            onPick={() => setOpen(false)}
            onShowAll={submit}
          />
        </div>
      )}
    </div>
  );
}
