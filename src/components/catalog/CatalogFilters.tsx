"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BrandNode, TypeNode } from "@/lib/catalog/brand-tree";

/**
 * Фільтри каталогу для показу клієнту.
 *
 * Головна вимога — торговий стоїть із планшетом перед клієнтом, тож усе
 * керується великими цілями дотику, а зміна фільтра не має скидати те, що
 * вже набрано. Стан тримаємо чернеткою і застосовуємо одним «Показати»:
 * інакше кожна галочка серед 114 брендів — це окремий перехід і очікування.
 */
interface Props {
  brands: BrandNode[];
  tailBrands: BrandNode[];
  unbranded: number;
  types: TypeNode[];
  priceBounds: { min: number; max: number };
  /** Куди застосовувати фільтри: вітрина чи кабінет торгового. */
  basePath?: string;
}

export default function CatalogFilters({
  brands,
  tailBrands,
  unbranded,
  types,
  priceBounds,
  basePath = "/catalog",
}: Props) {
  const sp = useSearchParams();

  // Чернетку скидаємо перемонтуванням через key, а не setState в ефекті:
  // після переходу джерелом істини стає URL, і синхронізувати його з
  // локальним станом вручну означало б зайвий каскад рендерів.
  return (
    <FiltersInner
      key={sp.toString()}
      brands={brands}
      tailBrands={tailBrands}
      unbranded={unbranded}
      types={types}
      priceBounds={priceBounds}
      basePath={basePath}
    />
  );
}

function FiltersInner({ brands, tailBrands, unbranded, types, priceBounds, basePath }: Required<Props>) {
  const router = useRouter();
  const sp = useSearchParams();

  const current = useMemo(
    () => ({
      brands: (sp.get("brand") || "").split(",").filter(Boolean),
      types: (sp.get("type") || "").split(",").filter(Boolean),
      priceMin: sp.get("priceMin") || "",
      priceMax: sp.get("priceMax") || "",
      showAll: sp.get("all") === "1",
      withImage: sp.get("withImage") === "1",
      search: sp.get("search") || "",
      sort: sp.get("sort") || "",
    }),
    [sp]
  );

  const [draft, setDraft] = useState(current);
  const [brandSearch, setBrandSearch] = useState("");
  const [showTail, setShowTail] = useState(false);
  const [open, setOpen] = useState(false);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(current), [draft, current]);

  const activeCount =
    current.brands.length +
    current.types.length +
    (current.priceMin ? 1 : 0) +
    (current.priceMax ? 1 : 0) +
    (current.showAll ? 1 : 0) +
    (current.withImage ? 1 : 0);

  const apply = useCallback(
    (next: typeof draft) => {
      const q = new URLSearchParams();
      if (next.brands.length) q.set("brand", next.brands.join(","));
      if (next.types.length) q.set("type", next.types.join(","));
      if (next.search) q.set("search", next.search);
      if (next.priceMin) q.set("priceMin", next.priceMin);
      if (next.priceMax) q.set("priceMax", next.priceMax);
      if (next.showAll) q.set("all", "1");
      if (next.withImage) q.set("withImage", "1");
      if (next.sort) q.set("sort", next.sort);
      const qs = q.toString();
      router.push(`${basePath}${qs ? `?${qs}` : ""}`);
      setOpen(false);
    },
    [router, basePath]
  );

  const toggle = (key: "brands" | "types", value: string) => {
    setDraft((d) => {
      const has = d[key].includes(value);
      return { ...d, [key]: has ? d[key].filter((v) => v !== value) : [...d[key], value] };
    });
  };

  const reset = () => {
    const cleared = { ...draft, brands: [], types: [], priceMin: "", priceMax: "", showAll: false, withImage: false };
    setDraft(cleared);
    apply(cleared);
  };

  const visibleBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    const pool = showTail ? [...brands, ...tailBrands] : brands;
    if (!q) return pool;
    return pool.filter((b) => b.name.toLowerCase().includes(q));
  }, [brandSearch, showTail, brands, tailBrands]);

  const body = (
    <div className="space-y-4">
      {/* Ціна */}
      <FilterBlock title="Ціна, грн">
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder={String(priceBounds.min)}
            value={draft.priceMin}
            onChange={(e) => setDraft((d) => ({ ...d, priceMin: e.target.value }))}
            className="h-11 w-full rounded-[10px] border border-[#E0E0E0] px-3 text-sm outline-none focus:border-[#FFD600]"
          />
          <span className="text-[#9E9E9E]">—</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder={String(priceBounds.max)}
            value={draft.priceMax}
            onChange={(e) => setDraft((d) => ({ ...d, priceMax: e.target.value }))}
            className="h-11 w-full rounded-[10px] border border-[#E0E0E0] px-3 text-sm outline-none focus:border-[#FFD600]"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            { label: "до 100", min: "", max: "100" },
            { label: "100–500", min: "100", max: "500" },
            { label: "500–2000", min: "500", max: "2000" },
            { label: "2000+", min: "2000", max: "" },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => setDraft((d) => ({ ...d, priceMin: p.min, priceMax: p.max }))}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                draft.priceMin === p.min && draft.priceMax === p.max
                  ? "border-[#FFD600] bg-[#FFD600] text-[#0A0A0A]"
                  : "border-[#E0E0E0] bg-white text-[#555] hover:bg-[#FAFAFA]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </FilterBlock>

      {/* Наявність */}
      <FilterBlock title="Показувати">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 active:bg-[#F7F7F7]">
          {/* Навпаки до колишнього «лише в наявності»: наявність тепер
              за замовчуванням, а галочка відкриває решту асортименту. */}
          <Check checked={draft.showAll} onChange={() => setDraft((d) => ({ ...d, showAll: !d.showAll }))} />
          <span className="text-sm text-[#1A1A1A]">Показати відсутні</span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 active:bg-[#F7F7F7]">
          <Check checked={draft.withImage} onChange={() => setDraft((d) => ({ ...d, withImage: !d.withImage }))} />
          <span className="text-sm text-[#1A1A1A]">Лише з фото</span>
        </label>
      </FilterBlock>

      {/* Групи товарів */}
      {types.length > 0 && (
        <FilterBlock title="Група товару">
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => {
              const on = draft.types.includes(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => toggle("types", t.key)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    on
                      ? "border-[#FFD600] bg-[#FFD600] font-semibold text-[#0A0A0A]"
                      : "border-[#EFEFEF] bg-[#FAFAFA] text-[#1A1A1A] hover:border-[#FFD600]"
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 text-xs ${on ? "text-[#0A0A0A]/60" : "text-[#9E9E9E]"}`}>{t.count}</span>
                </button>
              );
            })}
          </div>
        </FilterBlock>
      )}

      {/* Бренди */}
      <FilterBlock title="Бренди">
        <input
          value={brandSearch}
          onChange={(e) => setBrandSearch(e.target.value)}
          placeholder="Пошук бренда…"
          className="mb-2 h-11 w-full rounded-[10px] border border-[#E0E0E0] px-3 text-sm outline-none focus:border-[#FFD600]"
        />
        <div className="max-h-72 overflow-y-auto pr-1">
          {visibleBrands.map((b) => (
            <label
              key={b.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 active:bg-[#F7F7F7]"
            >
              <Check checked={draft.brands.includes(b.slug)} onChange={() => toggle("brands", b.slug)} />
              <span className="flex-1 truncate text-sm text-[#1A1A1A]">{b.name}</span>
              <span className="text-xs text-[#9E9E9E]">{b.count}</span>
            </label>
          ))}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 active:bg-[#F7F7F7]">
            <Check checked={draft.brands.includes("none")} onChange={() => toggle("brands", "none")} />
            <span className="flex-1 truncate text-sm text-[#555]">Без бренда</span>
            <span className="text-xs text-[#9E9E9E]">{unbranded}</span>
          </label>
        </div>
        {!brandSearch && tailBrands.length > 0 && (
          <button
            onClick={() => setShowTail((v) => !v)}
            className="mt-1 w-full py-2.5 text-center text-sm font-medium text-[#FFB800] transition hover:text-[#FFC400]"
          >
            {showTail ? "Згорнути дрібні бренди" : `Показати дрібні бренди (${tailBrands.length})`}
          </button>
        )}
      </FilterBlock>
    </div>
  );

  return (
    <>
      {/* Мобільна кнопка виклику */}
      <div className="md:hidden">
        <button
          onClick={() => setOpen(true)}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#EFEFEF] bg-white px-3 py-3 text-sm font-semibold text-[#0A0A0A] active:bg-[#FAFAFA]"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.03), 0 6px 20px rgba(0,0,0,0.05)" }}
        >
          <svg className="h-5 w-5 text-[#9E9E9E]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          Фільтри
          {activeCount > 0 && (
            <span className="rounded-full bg-[#FFD600] px-2 py-0.5 text-xs font-bold text-[#0A0A0A]">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* Мобільна панель */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 top-12 flex flex-col rounded-t-2xl bg-white">
            <div className="flex items-center justify-between border-b border-[#EFEFEF] px-4 py-3">
              <h2 className="text-base font-bold text-[#0A0A0A]">Фільтри</h2>
              <button
                onClick={() => setOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg active:bg-[#F7F7F7]"
              >
                <svg className="h-5 w-5 text-[#9E9E9E]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{body}</div>
            <div className="flex gap-2 border-t border-[#EFEFEF] p-3">
              <button
                onClick={reset}
                className="min-h-12 flex-1 rounded-[10px] border border-[#DADADA] text-sm font-semibold text-[#1A1A1A]"
              >
                Скинути
              </button>
              <button
                onClick={() => apply(draft)}
                className="min-h-12 flex-[2] rounded-[10px] bg-[#FFD600] text-sm font-bold text-[#0A0A0A]"
              >
                Показати
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Десктоп / планшет */}
      <div className="hidden md:block">
        <div className="rounded-xl border border-[#EFEFEF] bg-white p-4">
          {body}
          <div className="mt-4 flex gap-2">
            <button
              onClick={reset}
              disabled={activeCount === 0}
              className="min-h-11 flex-1 rounded-[10px] border border-[#DADADA] text-sm font-semibold text-[#1A1A1A] transition hover:bg-[#FAFAFA] disabled:opacity-40"
            >
              Скинути
            </button>
            <button
              onClick={() => apply(draft)}
              disabled={!dirty}
              className="min-h-11 flex-[2] rounded-[10px] bg-[#FFD600] text-sm font-bold text-[#0A0A0A] transition hover:bg-[#FFC400] disabled:opacity-40"
            >
              Показати
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function FilterBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#9E9E9E]">{title}</h3>
      {children}
    </div>
  );
}

function Check({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <span
      onClick={(e) => {
        e.preventDefault();
        onChange();
      }}
      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border-2 transition ${
        checked ? "border-[#FFD600] bg-[#FFD600]" : "border-[#DADADA] bg-white"
      }`}
    >
      {checked && (
        <svg className="h-4 w-4 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  );
}
