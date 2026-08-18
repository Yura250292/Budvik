"use client";

import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/utils";
import type { Suggestion } from "./useSuggest";
import NoPhoto from "@/components/ui/NoPhoto";

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
              <NoPhoto size="sm" />
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
