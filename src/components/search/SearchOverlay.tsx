"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSuggest } from "./useSuggest";
import SuggestList from "./SuggestList";

/**
 * Мобільний пошук на весь екран.
 *
 * На телефоні місця в шапці рівно на іконку, а випадайка під вузьким полем
 * ховається за клавіатурою. Тому окремий шар: велике поле зверху, підказки
 * під ним на всю висоту.
 */
export default function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, active, onKeyDown } = useSuggest(query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Перехід на товар чи в каталог має закривати шар — інакше він лишиться
  // висіти поверх сторінки, куди людина щойно перейшла.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    onClose();
  }, [pathname, onClose]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    // Фон не має скролитись під шаром
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    router.push(`/catalog?search=${encodeURIComponent(q)}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col">
      <div className="flex items-center gap-2 border-b border-[#E0E0E0] px-3 py-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрити пошук"
          className="p-2 -ml-1 text-[#555] active:scale-90 transition-transform"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const slug = onKeyDown(e);
            if (slug) {
              router.push(`/catalog/${slug}`);
              onClose();
            } else if (e.key === "Enter") {
              submit();
            }
          }}
          placeholder="Назва або артикул…"
          enterKeyHint="search"
          autoComplete="off"
          className="flex-1 min-w-0 h-11 rounded-[10px] border border-[#E0E0E0] bg-white px-3 text-[#0A0A0A] placeholder-[#9E9E9E] focus:border-[#FFD600] focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          className="h-11 flex-shrink-0 rounded-[10px] bg-[#FFD600] px-4 text-sm font-semibold text-[#0A0A0A] active:bg-[#FFB800]"
        >
          Знайти
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length > 0 ? (
          <SuggestList
            items={items}
            active={active}
            query={query}
            onPick={onClose}
            onShowAll={submit}
          />
        ) : (
          <p className="px-4 py-10 text-center text-sm text-[#9E9E9E]">
            {query.trim().length < 2
              ? "Почніть вводити назву або артикул"
              : "Нічого не знайшлося. Спробуйте інше слово."}
          </p>
        )}
      </div>
    </div>
  );
}
