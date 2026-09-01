"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Clock } from "lucide-react";
import { useSuggest } from "@/components/search/useSuggest";
import SuggestList from "@/components/search/SuggestList";

/** Список кабінету: сюди ведуть і Enter, і уточнення брендом чи групою. */
const LIST_PATH = "/sales/catalog/list";

/**
 * Останні запити торгового.
 *
 * Лежать у localStorage, а не на сервері: це зручність одного планшета, а не
 * дані. Вісім — стільки вміщається в пару рядків чипів на телефоні; далі це
 * вже стіна тексту, а не підказка.
 */
const HISTORY_KEY = "budvik_sales_search_history";
const HISTORY_MAX = 8;

function readHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string") : [];
  } catch {
    // Немає window (сервер), приватний режим чи зіпсований JSON — історії просто немає.
    return [];
  }
}

function remember(query: string): string[] {
  const q = query.trim();
  const next = [q, ...readHistory().filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, HISTORY_MAX);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* сховище недоступне — підказка без історії, і тільки */
  }
  return next;
}

function forgetAll() {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* те саме */
  }
}

/**
 * Пошук за назвою чи артикулом у каталозі торгового.
 *
 * Заради чого. Бекенд каталогу давно вміє ?search= — артикул сирим рядком,
 * стемінг, іншу розкладку, триграми на одрук, — а в кабінеті не було куди
 * його ввести: кнопка «Пошук і фільтри» вела в самі лише фільтри, і питання
 * клієнта «GR-30030 є?» означало вгадати розділ і гортати. Поле стоїть і на
 * змісті, і в списку, щоб не треба було спершу кудись переходити.
 *
 * Підказки — ті самі, що у вітрині (useSuggest + SuggestList): драбина
 * пошуку одна на сайт і застосунок, і третя копія розійшлася б із ними на
 * першій же правці. Відмінності лише в обгортці: уточнення ведуть у список
 * кабінету, а не в /catalog, і в рядку видно артикул — те, що клієнт
 * називає першим.
 *
 * Enter веде в список без решти фільтрів — так само, як шапка вітрини.
 * Підказки шукають по всьому каталогу, тож «GR-30030», знайдений у
 * випадайці, не має зникати після Enter лише тому, що список стояв у межах
 * іншого бренда. Звузити знайдене брендом чи розділом можна вже у списку —
 * фільтри там зберігають search.
 *
 * Чому не /catalog?search=: там стоїть SearchTracker, і запити торгових
 * потрапили б у список «що шукали покупці й не знайшли».
 */
export default function SalesCatalogSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  /*
   * Лінива ініціалізація замість ефекту: на сервері window немає, і
   * readHistory віддає порожній список; чипи показуємо лише у фокусі, тож
   * розмітка при гідрації збігається з серверною.
   */
  const [history, setHistory] = useState<string[]>(readHistory);
  const wrapper = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, brands, types, open, setOpen, active, onKeyDown } = useSuggest(query);

  useEffect(() => {
    const onOutside = (e: MouseEvent | TouchEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [setOpen]);

  const close = () => {
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  };

  const go = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setHistory(remember(q));
    close();
    router.push(`${LIST_PATH}?search=${encodeURIComponent(q)}`);
  };

  const showSuggest = open && items.length > 0;
  const showHistory = focused && !showSuggest && query.trim().length === 0 && history.length > 0;

  return (
    <div ref={wrapper} className="relative">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-cab-t3"
            strokeWidth={2}
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setFocused(true);
              if (items.length > 0) setOpen(true);
            }}
            onKeyDown={(e) => {
              const slug = onKeyDown(e);
              if (slug) {
                setHistory(remember(query));
                close();
                router.push(`/catalog/${slug}`);
              } else if (e.key === "Enter") {
                go(query);
              } else if (e.key === "Escape") {
                close();
              }
            }}
            placeholder="Назва або артикул…"
            aria-label="Пошук товару за назвою або артикулом"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            // text-base, а не text-sm: від 16px WebView не наближає сторінку при фокусі.
            className="h-12 w-full rounded-[10px] border border-cab-line bg-white pl-10 pr-10 text-base text-[#0A0A0A] placeholder-cab-t3 focus:border-[#FFD600] focus:outline-none focus:ring-2 focus:ring-[#FFD600]/30 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setOpen(false);
                inputRef.current?.focus();
              }}
              aria-label="Очистити"
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-cab-t3 active:bg-cab-bg"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => go(query)}
          className="h-12 shrink-0 rounded-[10px] bg-[#FFD600] px-4 text-sm font-bold text-[#0A0A0A] active:bg-[#FFC400]"
        >
          Знайти
        </button>
      </div>

      {(showSuggest || showHistory) && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-[60vh] overflow-y-auto rounded-xl border border-cab-line bg-white shadow-lg">
          {showSuggest ? (
            <SuggestList
              items={items}
              brands={brands}
              types={types}
              active={active}
              query={query}
              basePath={LIST_PATH}
              showSku
              onPick={() => {
                setHistory(remember(query));
                close();
              }}
              onShowAll={() => go(query)}
            />
          ) : (
            <div className="px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-cab-t3">Нещодавно шукали</span>
                <button
                  type="button"
                  onClick={() => {
                    forgetAll();
                    setHistory([]);
                  }}
                  className="text-xs font-medium text-cab-t2 active:text-[#0A0A0A]"
                >
                  Очистити
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {history.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => go(h)}
                    className="flex min-h-9 items-center gap-1.5 rounded-full border border-cab-line bg-cab-bg px-3 text-sm text-[#1A1A1A] active:bg-[#FFD600]/20"
                  >
                    <Clock className="h-3.5 w-3.5 text-cab-t3" strokeWidth={2} />
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
