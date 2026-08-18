"use client";

import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/utils";
import type { Suggestion } from "./useSuggest";

/**
 * Рядки підказок. Виділені окремо, бо однакові в трьох місцях, а різняться
 * лише обгорткою: у шапці це випадайка, у мобільному оверлеї — сам екран.
 */
export default function SuggestList({
  items,
  active,
  query,
  onPick,
  onShowAll,
}: {
  items: Suggestion[];
  active: number;
  query: string;
  onPick: () => void;
  onShowAll: () => void;
}) {
  return (
    <>
      {items.map((item, i) => (
        <Link
          key={item.id}
          href={`/catalog/${item.slug}`}
          onClick={onPick}
          className={`flex items-center gap-3 px-3 py-2.5 transition duration-150 ${
            i === active ? "bg-[#FFD600]/10" : "hover:bg-[#FAFAFA]"
          } ${i < items.length - 1 ? "border-b border-[#F0F0F0]" : ""}`}
        >
          <div className="relative w-10 h-10 flex-shrink-0 rounded-lg bg-[#F5F5F5] flex items-center justify-center overflow-hidden">
            {item.image ? (
              <Image src={item.image} alt="" fill className="object-contain" sizes="40px" />
            ) : (
              <svg className="w-5 h-5 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#0A0A0A] truncate">{item.name}</p>
            <p className="text-xs text-[#9E9E9E]">{item.category.name}</p>
          </div>
          <div className="flex-shrink-0 text-right">
            <span className={`text-sm font-bold ${item.stock > 0 ? "text-[#0A0A0A]" : "text-[#9E9E9E]"}`}>
              {formatPrice(item.price)}
            </span>
            {item.stock <= 0 && <p className="text-[10px] text-red-400">Немає</p>}
          </div>
        </Link>
      ))}

      <button
        type="button"
        onClick={onShowAll}
        className="w-full px-3 py-2.5 text-sm text-[#555] hover:bg-[#FAFAFA] transition font-medium text-center border-t border-[#E0E0E0]"
      >
        Показати всі результати для «{query.trim()}»
      </button>
    </>
  );
}
