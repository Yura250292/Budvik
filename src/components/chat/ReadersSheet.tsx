"use client";

/**
 * Хто переглянув повідомлення.
 *
 * Потрібно рівно там, де від відповіді залежить дія: «водій бачив зміну
 * адреси?». Тому список показує і тих, хто ще НЕ бачив, — саме це питання
 * і ставлять, а не «скільки галочок».
 */

import { X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { TAB_BAR_SPACE } from "@/components/cabinet/TabBar";
import { ROLE_LABEL } from "@/lib/chat/audience";
import type { Person } from "./api";

const time = (iso: string) =>
  new Date(iso).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ReadersSheet({
  seenBy,
  pending,
  seenAt,
  onClose,
}: {
  seenBy: Person[];
  pending: Person[];
  /** Коли саме людина дочитала — за id. */
  seenAt: Record<string, string>;
  onClose: () => void;
}) {
  const row = (p: Person, when?: string) => (
    <li key={p.id} className="flex items-center gap-3 border-b border-[#F1F1EF] px-4 py-2.5 last:border-0">
      <Avatar name={p.name} id={p.id} src={p.avatarUrl} color={p.color} size={34} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-bk">{p.name}</span>
        <span className="block text-[11px] text-cab-t3">{ROLE_LABEL[p.role] ?? p.role}</span>
      </span>
      {!!when && <span className="shrink-0 text-[11px] text-cab-t3">{time(when)}</span>}
    </li>
  );

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[70vh] flex-col rounded-t-2xl bg-white"
        // Відступ на панель вкладок, а не лише на виріз: інакше останній
        // рядок списку лежить під плаваючою капсулою меню.
        style={{ paddingBottom: TAB_BAR_SPACE }}
      >
        <div className="flex items-center justify-between border-b border-cab-line px-4 py-3">
          <span className="text-[15px] font-bold text-bk">Хто переглянув</span>
          <button type="button" onClick={onClose} aria-label="Закрити" className="flex h-11 w-11 items-center justify-center text-cab-t2">
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">
          <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-cab-t3">
            Переглянули ({seenBy.length})
          </p>
          {seenBy.length === 0 ? (
            <p className="px-4 py-2 text-[13px] text-cab-t3">Поки ніхто</p>
          ) : (
            <ul className="flex flex-col">{seenBy.map((p) => row(p, seenAt[p.id]))}</ul>
          )}

          {pending.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wide text-cab-t3">
                Ще не бачили ({pending.length})
              </p>
              <ul className="flex flex-col pb-3">{pending.map((p) => row(p))}</ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}
