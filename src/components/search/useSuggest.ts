"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Suggestion {
  id: string;
  name: string;
  slug: string;
  price: number;
  image?: string | null;
  stock: number;
  category: { name: string } | null;
  brand: { name: string; slug: string } | null;
}

/** Уточнення запиту: бренд або тип товару серед знайденого. */
export interface SuggestFacet {
  key: string;
  label: string;
  count: number;
}

/**
 * Підказки пошуку: один хук на всі три поля (шапка, мобільний оверлей,
 * велике поле в каталозі). Раніше ця логіка жила лише всередині AiSmartSearch,
 * і винести пошук у шапку означало б скопіювати її втретє.
 *
 * 250 мс — компроміс: менше давало запит на кожну літеру, більше відчувалось
 * як затримка.
 */
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

export function useSuggest(query: string) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [brands, setBrands] = useState<SuggestFacet[]>([]);
  const [types, setTypes] = useState<SuggestFacet[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Пізня відповідь на давно стертий запит не має перезаписувати свіжу.
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setItems([]);
      setBrands([]);
      setTypes([]);
      setOpen(false);
      return;
    }

    const mine = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/suggest?q=${encodeURIComponent(q)}`);
        if (!res.ok || mine !== seq.current) return;
        /*
         * Роут тепер віддає об'єкт із уточненнями, а не голий масив: разом із
         * товарами приїжджають бренди й типи серед знайденого. Так влаштована
         * випадайка у великих магазинах техніки — вісім підказок не звужують
         * нічого, а один дотик по бренду звужує вдвічі.
         */
        const data: { items: Suggestion[]; brands: SuggestFacet[]; types: SuggestFacet[] } =
          await res.json();
        setItems(data.items);
        setBrands(data.brands ?? []);
        setTypes(data.types ?? []);
        setOpen(data.items.length > 0);
        setActive(-1);
      } catch {
        /* мовчки: підказки — допоміжна річ, помилка не має лізти в очі */
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  /** Навігація стрілками. Повертає slug, якщо Enter натиснуто на підказці. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): string | null => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, -1));
      } else if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "Enter") {
        if (active >= 0 && items[active]) {
          setOpen(false);
          return items[active].slug;
        }
      }
      return null;
    },
    [items, active]
  );

  return { items, brands, types, open, setOpen, active, onKeyDown };
}
