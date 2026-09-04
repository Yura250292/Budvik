"use client";

/**
 * Вхід у помічника з головної кабінету.
 *
 * Стоїть під прострочкою, а не над планом: перше питання, з яким торговий
 * відкриває кабінет, — «як у мене справи», і відповідає на нього план.
 * Помічник — наступний крок, «що з цим робити», і саме там він і потрібен.
 *
 * Підпис перелічує три конкретні дії, а не описує можливості: «помічник з
 * доступом до даних» нікому нічого не каже, а «з чим заходити» — каже.
 */

import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";

export default function AssistantTile() {
  return (
    <Link
      href="/sales/assistant"
      className="flex items-center gap-3 rounded-2xl border border-cab-line bg-white p-3.5 active:opacity-70"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-bk">
        <Sparkles size={18} className="text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-bk">Помічник</span>
        <span className="block truncate text-xs text-cab-t3">
          Сплануй день · кому нагадати про борг · з чим заходити
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-cab-t3" />
    </Link>
  );
}
