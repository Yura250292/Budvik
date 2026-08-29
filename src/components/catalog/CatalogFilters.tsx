"use client";

import { useState, useMemo, useCallback, useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BrandNode, TypeNode } from "@/lib/catalog/brand-tree";
import type { AttrFacet } from "@/lib/catalog/query";

/**
 * Фільтри каталогу для показу клієнту.
 *
 * Головна вимога — торговий стоїть із планшетом перед клієнтом, тож усе
 * керується великими цілями дотику, а зміна фільтра не має скидати те, що
 * вже набрано. Стан тримаємо чернеткою і застосовуємо одним «Показати»:
 * інакше кожна галочка серед 114 брендів — це окремий перехід і очікування.
 */
/** Скільки брендів показуємо, поки не натиснуть «Ще N брендів». */
const BRANDS_SHOWN = 20;

/** Розділ каталогу як рівень фільтра: обрати — це обрати всі його типи. */
export interface SectionOption {
  id: string;
  title: string;
  count: number;
}

interface Props {
  brands: BrandNode[];
  tailBrands: BrandNode[];
  unbranded: number;
  types: TypeNode[];
  /**
   * Розділи каталогу. Порожньо — коли розділ не має сенсу: у кабінеті
   * торгового шукають за артикулом і брендом, а не гортають вітрину.
   */
  sections?: SectionOption[];
  /**
   * Скільки товарів дає бренд у поточній видачі (slug → кількість, «none» —
   * без бренда). Порожньо — показуємо глобальні числа з дерева брендів.
   */
  brandCounts?: Record<string, number>;
  priceBounds: { min: number; max: number };
  /**
   * Характеристики, доречні для поточного місця каталогу: живлення, діаметр
   * диска, напруга. Приходять уже з лічильниками й без порожніх значень —
   * сервер знає, що є у видачі, а клієнт лише малює.
   */
  attrFacets?: AttrFacet[];
  /** Куди застосовувати фільтри: вітрина чи кабінет торгового. */
  basePath?: string;
  /**
   * Яким «Показати відсутні» є, поки в URL немає ?all.
   *
   * У вітрині — вимкненим, у кабінеті торгового — увімкненим: там відсутню
   * позицію беруть під замовлення. Без цього галочка стояла порожньою на
   * екрані, де відсутні товари й так показані, а зняти її було нічим.
   */
  defaultShowAll?: boolean;
}

export default function CatalogFilters({
  brands,
  tailBrands,
  unbranded,
  types,
  sections = [],
  brandCounts = {},
  priceBounds,
  attrFacets = [],
  basePath = "/catalog",
  defaultShowAll = false,
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
      sections={sections}
      brandCounts={brandCounts}
      priceBounds={priceBounds}
      attrFacets={attrFacets}
      basePath={basePath}
      defaultShowAll={defaultShowAll}
    />
  );
}

function FiltersInner({
  brands,
  tailBrands,
  unbranded,
  types,
  sections,
  brandCounts,
  priceBounds,
  attrFacets,
  basePath,
  defaultShowAll,
}: Required<Props>) {
  const router = useRouter();
  const sp = useSearchParams();

  const current = useMemo(
    () => {
      // Характеристики читаємо лише ті, що зараз доречні: ключі приходять
      // разом із фасетами, тож чужий параметр в адресі в чернетку не потрапить.
      const attrs: Record<string, string[]> = {};
      for (const fa of attrFacets) {
        const vals = (sp.get(fa.key) || "").split(",").filter(Boolean);
        if (vals.length) attrs[fa.key] = vals;
      }
      return {
        brands: (sp.get("brand") || "").split(",").filter(Boolean),
        types: (sp.get("type") || "").split(",").filter(Boolean),
        section: sp.get("section") || "",
        priceMin: sp.get("priceMin") || "",
        priceMax: sp.get("priceMax") || "",
        showAll: sp.has("all") ? sp.get("all") === "1" : defaultShowAll,
        withImage: sp.get("withImage") === "1",
        search: sp.get("search") || "",
        sort: sp.get("sort") || "",
        attrs,
      };
    },
    [sp, defaultShowAll, attrFacets]
  );

  const [draft, setDraft] = useState(current);
  const [brandSearch, setBrandSearch] = useState("");
  const [showTail, setShowTail] = useState(false);
  const [open, setOpen] = useState(false);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(current), [draft, current]);

  const activeCount =
    current.brands.length +
    current.types.length +
    (current.section ? 1 : 0) +
    (current.priceMin ? 1 : 0) +
    (current.priceMax ? 1 : 0) +
    (current.showAll !== defaultShowAll ? 1 : 0) +
    (current.withImage ? 1 : 0) +
    Object.values(current.attrs).reduce((n, v) => n + v.length, 0);

  const apply = useCallback(
    (next: typeof draft) => {
      const q = new URLSearchParams();
      if (next.brands.length) q.set("brand", next.brands.join(","));
      if (next.section) q.set("section", next.section);
      if (next.types.length) q.set("type", next.types.join(","));
      if (next.search) q.set("search", next.search);
      if (next.priceMin) q.set("priceMin", next.priceMin);
      if (next.priceMax) q.set("priceMax", next.priceMax);
      // all=0 теж пишемо: у кабінеті торгового дефолт — «з відсутніми», і
      // без явного нуля вибір «лише наявне» губився на другій сторінці.
      if (next.showAll !== defaultShowAll) q.set("all", next.showAll ? "1" : "0");
      if (next.withImage) q.set("withImage", "1");
      if (next.sort) q.set("sort", next.sort);
      // Порядком фасетів, а не Object.keys: адреса має бути та сама при тому
      // самому наборі галочок, інакше кеш видачі не спрацює.
      for (const fa of attrFacets) {
        const vals = next.attrs[fa.key];
        if (vals?.length) q.set(fa.key, vals.join(","));
      }
      const qs = q.toString();
      router.push(`${basePath}${qs ? `?${qs}` : ""}`);
      setOpen(false);
    },
    [router, basePath, defaultShowAll, attrFacets]
  );

  const toggle = (key: "brands" | "types", value: string) => {
    setDraft((d) => {
      const has = d[key].includes(value);
      return { ...d, [key]: has ? d[key].filter((v) => v !== value) : [...d[key], value] };
    });
  };

  /**
   * Клік по групі товару звужує розділ, а не замінює його.
   *
   * Розділ тепер живе в окремому ?section=, тож зняття останньої групи
   * повертає людину до всього розділу, а не до всього каталогу: саме цього
   * і чекають від кнопки «назад на крок».
   */
  const pickType = (value: string) => {
    setDraft((d) => {
      const has = d.types.includes(value);
      return { ...d, types: has ? d.types.filter((v) => v !== value) : [...d.types, value] };
    });
  };

  /** Галочка характеристики: кілька значень одного фасета — це «або». */
  const toggleAttr = (key: string, value: string) => {
    setDraft((d) => {
      const cur = d.attrs[key] ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      const attrs = { ...d.attrs };
      if (next.length) attrs[key] = next;
      else delete attrs[key];
      return { ...d, attrs };
    });
  };

  const reset = () => {
    const cleared = {
      ...draft,
      brands: [],
      types: [],
      section: "",
      priceMin: "",
      priceMax: "",
      showAll: defaultShowAll,
      withImage: false,
      attrs: {},
    };
    setDraft(cleared);
    apply(cleared);
  };

  /** Чи прийшли числа в розрізі поточної видачі. */
  const faceted = Object.keys(brandCounts).length > 0;

  /** Скільки товарів цього бренда людина справді побачить. */
  const brandCount = (slug: string, fallback: number) =>
    faceted ? brandCounts[slug] ?? 0 : fallback;

  /**
   * Кого показувати у списку брендів.
   *
   * Коли є фасети, поділ на «головні» й «дрібні» за глобальною кількістю
   * перестає працювати: у розділі «Скотч та стрічки» головні бренди дають
   * нуль, а весь товар лежить у двох марках, які глобально дрібні й ховались
   * за «показати дрібні бренди». Тому при фасетах список один, порожні
   * бренди в ньому не показуємо взагалі, а порядок — за кількістю тут.
   */
  const visibleBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    const all = [...brands, ...tailBrands];

    let pool = faceted
      ? all
          .filter((b) => (brandCounts[b.slug] ?? 0) > 0)
          .sort((a, b) => (brandCounts[b.slug] ?? 0) - (brandCounts[a.slug] ?? 0))
      : showTail
        ? all
        : brands;

    if (q) return pool.filter((b) => b.name.toLowerCase().includes(q));
    if (faceted && !showTail) pool = pool.slice(0, BRANDS_SHOWN);
    return pool;
  }, [brandSearch, showTail, brands, tailBrands, brandCounts, faceted]);

  /** Скільки брендів лишилось під згорткою — для підпису кнопки. */
  const hiddenBrands = faceted
    ? [...brands, ...tailBrands].filter((b) => (brandCounts[b.slug] ?? 0) > 0).length - BRANDS_SHOWN
    : tailBrands.length;

  /**
   * Обраний розділ — той, що стоїть у ?section=.
   *
   * Без useMemo навмисно: компілятор React не зміг би зберегти ручну
   * мемоїзацію по полю чернетки і мовчки лишив би весь компонент
   * неоптимізованим — а список зі 114 брендів усередині.
   */
  const activeSection = sections.find((s) => s.id === draft.section) ?? null;

  /**
   * Бренди чернетки людськими назвами — для рядка контексту.
   *
   * Мапу будуємо з тих самих списків, що вже прийшли пропсами: окремого
   * джерела назв тут не потрібно, а slug у заголовку («polax») читався б як
   * технічний рядок, а не як фірма, у межах якої людина зараз перебуває.
   */
  const draftBrandNames = useMemo(() => {
    const bySlug = new Map([...brands, ...tailBrands].map((b) => [b.slug, b.name]));
    return draft.brands.map((s) => (s === "none" ? "Без бренда" : bySlug.get(s) ?? s));
  }, [draft.brands, brands, tailBrands]);

  const body = (
    <div className="space-y-3">
      {/*
        Рамка, у якій людина зараз перебуває.

        Бренд звужує все нижче — розділи, групи й числа біля них рахуються в
        його межах. Без цього рядка панель виглядала так, ніби показує весь
        каталог, і порожні розділи всередині дрібної фірми читались як
        поламаний фільтр, а не як «у цієї фірми такого немає».
      */}
      {draftBrandNames.length > 0 && (
        <div className="flex items-center gap-2 rounded-[10px] bg-[#0A0A0A] px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#FFD600]">
            У межах: {draftBrandNames.join(", ")}
          </span>
          <button
            onClick={() => setDraft((d) => ({ ...d, brands: [] }))}
            className="flex-shrink-0 cursor-pointer rounded px-1.5 py-1 text-xs font-medium text-[#FFD600]/70 transition hover:text-[#FFD600]"
          >
            Весь каталог
          </button>
        </div>
      )}

      {/*
        Розділ — верхній рівень дерева.

        Без нього фільтри вміли звужувати вже обране, але не пропонували, з
        чого почати: людині, яка прийшла пошуком і нічого не знайшла,
        лишалась сітка на 49 тис. позицій і список зі 114 брендів. Розділ
        їде окремим ?section=, тож посилання з вітрини й вибір тут дають
        однакову адресу.
      */}
      {sections.length > 0 && (
        <FilterBlock title="Розділ" defaultOpen={!activeSection}>
          <div className="max-h-72 overflow-y-auto pr-1">
            {sections.map((sec) => {
              const on = draft.section === sec.id;
              return (
                <button
                  key={sec.id}
                  // Зміна розділу скидає групи: «свердло» з оснастки не має
                  // сенсу всередині садової техніки, а порожня видача виглядає
                  // як поламаний фільтр.
                  onClick={() =>
                    setDraft((d) => (on ? { ...d, section: "", types: [] } : { ...d, section: sec.id, types: [] }))
                  }
                  aria-pressed={on}
                  className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left transition-colors duration-200 ${
                    on ? "bg-[#FFD600]/25 font-semibold text-[#0A0A0A]" : "text-[#1A1A1A] hover:bg-[#FAFAFA]"
                  }`}
                >
                  <span className="flex-1 truncate text-sm">{sec.title}</span>
                  <span className="text-xs tabular-nums text-[#9E9E9E]">{sec.count}</span>
                </button>
              );
            })}
          </div>
        </FilterBlock>
      )}

      {/* Групи товарів усередині розділу (або бренда) */}
      {types.length > 0 && (
        <FilterBlock title="Групи товару" defaultOpen={Boolean(activeSection) || draft.brands.length > 0}>
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => {
              const on = draft.types.includes(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => pickType(t.key)}
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

      {/*
        Характеристики — те, чим товар обирають насправді.

        Бренд і група відповідають на питання «що це», але болгарку беруть не
        за фірмою: спершу акумуляторна чи мережева, потім який круг стає.
        Блоки приходять уже підібраними під місце в каталозі — над пензлями
        «Діаметр диска» не зʼявиться, — і з лічильниками, тож видно, чи є за
        чим іти, ще до кліку.
      */}
      {attrFacets.map((fa) => (
        <FilterBlock key={fa.key} title={fa.label} defaultOpen>
          <div className="flex flex-wrap gap-1.5">
            {fa.options.map((o) => {
              const on = (draft.attrs[fa.key] ?? []).includes(o.value);
              return (
                <button
                  key={o.value}
                  onClick={() => toggleAttr(fa.key, o.value)}
                  aria-pressed={on}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-sm transition ${
                    on
                      ? "border-[#FFD600] bg-[#FFD600] font-semibold text-[#0A0A0A]"
                      : "border-[#EFEFEF] bg-[#FAFAFA] text-[#1A1A1A] hover:border-[#FFD600]"
                  }`}
                >
                  {o.label}
                  <span className={`ml-1.5 text-xs ${on ? "text-[#0A0A0A]/60" : "text-[#9E9E9E]"}`}>
                    {o.count}
                  </span>
                </button>
              );
            })}
          </div>
        </FilterBlock>
      ))}

      {/* Ціна */}
      <FilterBlock title="Ціна, грн" defaultOpen={!activeSection}>
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

      {/* Бренди */}
      <FilterBlock title="Бренди" defaultOpen={!activeSection}>
        <input
          value={brandSearch}
          onChange={(e) => setBrandSearch(e.target.value)}
          placeholder="Пошук бренда…"
          className="mb-2 h-11 w-full rounded-[10px] border border-[#E0E0E0] px-3 text-sm outline-none focus:border-[#FFD600]"
        />
        <div className="max-h-72 overflow-y-auto pr-1">
          {visibleBrands.map((b) => (
            <CheckRow key={b.id} checked={draft.brands.includes(b.slug)} onChange={() => toggle("brands", b.slug)}>
              <span className="flex-1 truncate text-sm text-[#1A1A1A]">{b.name}</span>
              <span className="text-xs tabular-nums text-[#9E9E9E]">{brandCount(b.slug, b.count)}</span>
            </CheckRow>
          ))}
          {(!faceted || (brandCounts.none ?? 0) > 0) && (
          <CheckRow checked={draft.brands.includes("none")} onChange={() => toggle("brands", "none")}>
            <span className="flex-1 truncate text-sm text-[#555]">Без бренда</span>
            <span className="text-xs tabular-nums text-[#9E9E9E]">{brandCount("none", unbranded)}</span>
          </CheckRow>
          )}
        </div>
        {!brandSearch && hiddenBrands > 0 && (
          <button
            onClick={() => setShowTail((v) => !v)}
            className="mt-1 w-full py-2.5 text-center text-sm font-medium text-[#FFB800] transition hover:text-[#FFC400]"
          >
            {showTail
              ? "Згорнути список"
              : faceted
                ? `Ще ${hiddenBrands} брендів`
                : `Показати дрібні бренди (${hiddenBrands})`}
          </button>
        )}
      </FilterBlock>

      {/* Наявність — не рівень дерева, а те, як людина дивиться на будь-який
          із них: тому в самому низу, під усіма фільтрами. */}
      <FilterBlock title="Показувати" defaultOpen={false}>
        {/* Навпаки до колишнього «лише в наявності»: наявність тепер
            за замовчуванням, а галочка відкриває решту асортименту. */}
        <CheckRow checked={draft.showAll} onChange={() => setDraft((d) => ({ ...d, showAll: !d.showAll }))}>
          <span className="text-sm text-[#1A1A1A]">Показати відсутні</span>
        </CheckRow>
        <CheckRow checked={draft.withImage} onChange={() => setDraft((d) => ({ ...d, withImage: !d.withImage }))}>
          <span className="text-sm text-[#1A1A1A]">Лише з фото</span>
        </CheckRow>
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

      {/*
        Мобільна панель.

        z-[60], а не z-50: нижнє меню — і вітрини, і кабінету торгового —
        теж z-50 і йде пізніше в розмітці, тож малювалось поверх нижнього
        рядка панелі. Кнопки «Скинути» і «Показати» були під ним, фільтр не
        застосовувався взагалі, і єдиним виходом лишався хрестик.
      */}
      {open && (
        <div className="fixed inset-0 z-[60] md:hidden">
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
            <div
              className="flex gap-2 border-t border-[#EFEFEF] p-3"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
            >
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

/**
 * Група фільтрів, яку можна згорнути.
 *
 * У колонці одночасно живуть розділи, групи товару, ціна й півтори сотні
 * брендів — розгорнуте це кілька екранів прокрутки, а на телефоні панель
 * фільтрів і поготів. Заголовок групи тепер кнопка: те, чим людина зараз не
 * користується, згортається й не заважає дістатись решти.
 */
function FilterBlock({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className="border-b border-[#F2F2F2] pb-3 last:border-b-0 last:pb-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wide text-[#9E9E9E]">{title}</span>
        <svg
          aria-hidden
          className={`h-4 w-4 flex-shrink-0 text-[#C9C9C9] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/**
 * Рядок-галочка з живою ціллю дотику на всю ширину.
 *
 * Раніше обробник кліку висів на самому квадратику 24px усередині <label>
 * без жодного input — тобто тап по назві бренда не робив нічого, і фільтр
 * здавався зламаним. Тепер клік ловить справжній checkbox, схований у
 * рядку: працює і по тексту, і з клавіатури.
 */
function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    /*
      relative тут не для позиціонування, а щоб мітка стала контейнером для
      свого sr-only інпута: той — position:absolute, і без позиціонованого
      предка його контейнером ставало <body>. Список брендів обрізаний
      (max-h-72 overflow-y-auto), але обрізання не діє на абсолют із чужим
      контейнером — і схований інпут останнього бренда опинявся за пів
      тисячі пікселів нижче підвала, розтягуючи прокрутку всієї сторінки.
    */
    <label className="relative flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 outline-none active:bg-[#F7F7F7] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#FFD600]">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <Check checked={checked} />
      {children}
    </label>
  );
}

function Check({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
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
