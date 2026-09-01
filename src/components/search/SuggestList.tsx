"use client";

import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/utils";
import type { Suggestion, SuggestFacet } from "./useSuggest";
import { productLabel } from "@/lib/catalog/category-display";
import { isRealSku } from "@/lib/catalog/sku-search";
import NoPhoto from "@/components/ui/NoPhoto";

/**
 * Рядки підказок. Виділені окремо, бо однакові в чотирьох місцях, а різняться
 * лише обгорткою: у шапці це випадайка, у мобільному оверлеї — сам екран, у
 * кабінеті торгового — панель під полем на змісті каталогу.
 */
export default function SuggestList({
  items,
  brands = [],
  types = [],
  active,
  query,
  basePath = "/catalog",
  showSku = false,
  onPick,
  onShowAll,
}: {
  items: Suggestion[];
  /** Уточнення: бренди й типи серед знайденого. Без них список просто довший. */
  brands?: SuggestFacet[];
  types?: SuggestFacet[];
  active: number;
  query: string;
  /**
   * Куди ведуть уточнення: вітрина чи список кабінету торгового. Сам товар
   * завжди відкривається карткою /catalog/[slug] — вона одна на обидва.
   */
  basePath?: string;
  /** Показати артикул перед ярликом: у кабінеті клієнт називає його першим. */
  showSku?: boolean;
  onPick: () => void;
  onShowAll: () => void;
}) {
  const q = query.trim();

  return (
    <>
      {/*
        Уточнення над товарами.

        «Дриль» — це півтори сотні позицій, і людині потрібен не довший
        список, а наступне питання: чий і який саме. Вісім підказок не
        звужують нічого, а один клік по бренду звужує вдвічі.
      */}
      {(types.length > 0 || brands.length > 0) && (
        <div className="border-b border-[#F0F0F0] px-3 py-2.5">
          {types.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {types.map((t) => (
                <Link
                  key={`t-${t.key}`}
                  href={`${basePath}?search=${encodeURIComponent(q)}&type=${encodeURIComponent(t.key)}`}
                  onClick={onPick}
                  className="cursor-pointer rounded-full border border-[#E5E5E5] bg-[#FAFAFA] px-3 py-1 text-xs font-medium text-[#1A1A1A] transition-colors duration-200 hover:border-[#FFD600] hover:bg-[#FFD600]/15"
                >
                  {t.label}
                </Link>
              ))}
            </div>
          )}
          {brands.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {brands.map((b) => (
                <Link
                  key={`b-${b.key}`}
                  href={`${basePath}?search=${encodeURIComponent(q)}&brand=${encodeURIComponent(b.key)}`}
                  onClick={onPick}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-[#E5E5E5] px-3 py-1 text-xs text-[#1A1A1A] transition-colors duration-200 hover:border-[#FFD600] hover:bg-[#FFD600]/15"
                >
                  {b.label}
                  <span className="text-[10px] tabular-nums text-[#9E9E9E]">{b.count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
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
            {/* Ярлик через productLabel: у полі category лежить назва з 1С
                разом із номером вузла («02.03. Дрилі-шуруповерти»), а в 84%
                товарів там узагалі звалище «Імпорт з 1С» — тоді показуємо
                бренд. */}
            <p className="text-xs text-[#9E9E9E]">
              {showSku && isRealSku(item.sku) && (
                <span className="font-medium tabular-nums text-[#555]">{item.sku} · </span>
              )}
              {productLabel(item.category, item.brand)}
            </p>
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
