"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { TableScroll } from "@/components/ui/TableScroll";
import { ProductPanel } from "./ProductPanel";
import type { LowStockItem, LowStockReport, LowStockSection } from "@/lib/procurement/low-stock";
import { DEFAULT_VELOCITY_DAYS, VELOCITY_OPTIONS } from "@/lib/analytics/velocity-window";

/**
 * Закупівлі: що замовити.
 *
 * Сторінка відкривається одразу зі станом усього складу — бренд тут фільтр,
 * а не обов'язковий перший крок: закупівельник щодня працює не з одним
 * брендом, і порожній екран із селектом змушував би вгадувати, з чого почати.
 *
 * Сигнал дає обіг, а не формальний поріг: «продається і скінчилось» —
 * червоне, «вистачить менш ніж на місяць» — помаранчеве. Позиції без
 * продажів і без залишку (33 з 40 тис.) сховані за галочкою, інакше вони
 * ховають справжню роботу.
 *
 * Кошик живе в стані сторінки: галочка + кількість, унизу — панель із
 * підсумком і вивантаженням заявки. Кількість підставляється рекомендована
 * (≈2 місяці продажів), але її можна виправити.
 */

type Brand = { id: string; name: string; products: number };

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });

const SEV_ROW = ["#FEE2E2", "#FFEDD5", "#FEF9C3", "transparent"];
const SEV_LABEL = ["Терміново", "Мало", "Нижче норми", "ок"];
const SEV_COLOR = ["#B91C1C", "#C2410C", "#A16207", "#6B7280"];

export default function ProcurementPage() {
  const [brandId, setBrandId] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expensivePrice, setExpensivePrice] = useState(1000);
  const [expensiveMin, setExpensiveMin] = useState(5);
  const [cheapMin, setCheapMin] = useState(10);
  const [includeDead, setIncludeDead] = useState(false);
  const [days, setDays] = useState(DEFAULT_VELOCITY_DAYS);
  const [minSeverity, setMinSeverity] = useState(2); // показувати все, що < 3
  const [showSettings, setShowSettings] = useState(false);
  const [showBrands, setShowBrands] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: brandsData } = useSWR<{ brands: Brand[] }>("/api/admin/procurement/brands", fetcher);

  // days їде і в SWR-запит, і (через replace шляху) в лінк «звіт в Excel» —
  // вивантаження має відповідати тому, що на екрані.
  const query =
    `/api/admin/procurement?expensivePrice=${expensivePrice}&expensiveMin=${expensiveMin}` +
    `&cheapMin=${cheapMin}&days=${days}${brandId ? `&brandId=${brandId}` : ""}` +
    `${includeDead ? "&includeDead=1" : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`;

  const { data, error, isLoading } = useSWR<{ report: LowStockReport }>(query, fetcher, { keepPreviousData: true });
  const report = data?.report;

  const visibleSections = useMemo<LowStockSection[]>(() => {
    if (!report) return [];
    return report.sections
      .map((s) => ({
        ...s,
        groups: s.groups
          .map((g) => {
            const items = g.items.filter((i) => i.severity <= minSeverity);
            return { ...g, items, total: items.length, toOrder: items.filter((i) => i.severity < 3).length };
          })
          .filter((g) => g.items.length > 0),
      }))
      .filter((s) => s.groups.length > 0)
      .map((s) => ({
        ...s,
        total: s.groups.reduce((n, g) => n + g.total, 0),
        toOrder: s.groups.reduce((n, g) => n + g.toOrder, 0),
      }));
  }, [report, minSeverity]);

  const allVisible = useMemo(
    () => visibleSections.flatMap((s) => s.groups).flatMap((g) => g.items),
    [visibleSections],
  );

  const toggle = useCallback((item: LowStockItem) => {
    setCart((prev) => {
      const next = { ...prev };
      if (next[item.id] != null) delete next[item.id];
      else next[item.id] = item.suggested || 1;
      return next;
    });
  }, []);

  const setQty = useCallback((id: string, qty: number) => {
    setCart((prev) => ({ ...prev, [id]: Math.max(1, Math.round(qty) || 1) }));
  }, []);

  const addAllVisible = useCallback(() => {
    setCart((prev) => {
      const next = { ...prev };
      for (const i of allVisible) if (i.severity < 3 && next[i.id] == null) next[i.id] = i.suggested || 1;
      return next;
    });
  }, [allVisible]);

  const cartIds = Object.keys(cart);
  const cartSum = useMemo(() => {
    const byId = new Map(allVisible.map((i) => [i.id, i]));
    return cartIds.reduce((s, id) => s + (byId.get(id)?.price ?? 0) * cart[id], 0);
  }, [cartIds, cart, allVisible]);

  const downloadCart = useCallback(async () => {
    const res = await fetch("/api/admin/procurement/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cartIds.map((id) => ({ id, qty: cart[id] })) }),
    });
    if (!res.ok) return alert("Не вдалося сформувати заявку");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Заявка.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }, [cartIds, cart]);

  return (
    <div className="p-4 md:p-6 space-y-4 pb-28">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Закупівлі</h1>
          <p className="text-sm text-g400">
            Що замовити: сигнал дає обіг за {report?.velocityDays ?? days} днів. Лише номенклатура з 1С.
          </p>
        </div>
        <a
          href={query.replace("/api/admin/procurement?", "/api/admin/procurement/export?")}
          className="flex h-10 items-center rounded-[var(--radius-btn)] border border-g100 px-4 text-sm font-semibold hover:bg-g50"
        >
          ⬇ Увесь звіт в Excel
        </a>
      </div>

      {report && (
        <div className="flex flex-wrap gap-3">
          <Stat label="Терміново" value={report.urgent} tone="#B91C1C" hint="продається і скінчилось" />
          <Stat label="Усього замовити" value={report.toOrder} tone="#A16207" />
          <Stat
            label="Сума закупівлі"
            value={`${report.orderCost.toLocaleString("uk-UA")} ₴`}
            hint={report.noPrice > 0 ? `без ${report.noPrice} поз. без ціни` : undefined}
          />
          <Stat label="Позицій у роботі" value={report.total} hint={`${report.hiddenDead} мертвих сховано`} />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="h-10 min-w-52 rounded-[var(--radius-btn)] border border-g100 bg-white px-3 text-sm"
          >
            <option value="">Усі бренди</option>
            {brandsData?.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.products})
              </option>
            ))}
          </select>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Пошук: назва або артикул"
              className="h-10 w-60 rounded-[var(--radius-btn)] border border-g100 px-3 text-sm"
            />
            <button type="submit" className="h-10 rounded-[var(--radius-btn)] bg-bk px-4 text-sm font-semibold text-white">
              Знайти
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setSearchInput("");
                }}
                className="h-10 px-2 text-sm text-g400 hover:text-bk"
              >
                ✕ скинути
              </button>
            )}
          </form>

          <div className="flex overflow-hidden rounded-[var(--radius-btn)] border border-g100">
            {[
              { v: 0, label: "Тільки термінові" },
              { v: 1, label: "Термінові + мало" },
              { v: 2, label: "Усе до замовлення" },
              { v: 3, label: "Показати все" },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setMinSeverity(o.v)}
                className={`h-10 px-3 text-sm ${minSeverity === o.v ? "bg-bk text-white" : "bg-white hover:bg-g50"}`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Вікно обігу: за скільки днів рахуються продажі й дефіцит. */}
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-[var(--radius-btn)] border border-g100">
              {VELOCITY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`h-10 px-3 text-sm ${days === d ? "bg-bk text-white" : "bg-white hover:bg-g50"}`}
                >
                  {d} дн.
                </button>
              ))}
            </div>
            <span className="text-xs text-g400">обіг за цей період</span>
          </div>

          <button
            onClick={() => setShowSettings((v) => !v)}
            className="h-10 rounded-[var(--radius-btn)] border border-g100 px-3 text-sm hover:bg-g50"
          >
            ⚙ Норми {showSettings ? "▴" : "▾"}
          </button>
        </div>

        {showSettings && (
          <div className="flex flex-wrap items-end gap-3 border-t border-g100 p-4">
            <NumField label="«Дорогий» від, грн" value={expensivePrice} onChange={setExpensivePrice} width="w-32" />
            <NumField label="Мін. дорогі, шт" value={expensiveMin} onChange={setExpensiveMin} />
            <NumField label="Мін. кількісні, шт" value={cheapMin} onChange={setCheapMin} />
            <label className="flex h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={includeDead} onChange={(e) => setIncludeDead(e.target.checked)} />
              Показати позиції без продажів (мертві)
            </label>
            <p className="w-full text-xs text-g400">
              Норми діють лише для позицій без історії продажів. Там, де продажі є, дефіцит рахується за обігом.
            </p>
          </div>
        )}
      </Card>

      {error && <div className="rounded-[var(--radius-card)] bg-red-50 p-4 text-sm text-red-700">{String(error.message)}</div>}
      {isLoading && !report && <div className="p-6 text-center text-sm text-g400">Рахуємо продажі й залишки…</div>}

      {report && !brandId && report.brands.length > 0 && (
        <Card>
          {/*
            Згортається і за замовчуванням закрита: зведення по брендах — це
            довідка «куди дивитись», а не робота. Розгорнутою вона займала
            весь екран і відсувала товари, заради яких сторінка й існує.
          */}
          <button
            onClick={() => setShowBrands((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left font-bold hover:bg-g50"
          >
            <span>
              Бренди — де найбільше роботи
              <span className="ml-2 text-xs font-normal text-g400">{report.brands.length} брендів у роботі</span>
            </span>
            <span className="text-g400">{showBrands ? "▴" : "▾"}</span>
          </button>
          {showBrands && (
          <TableScroll stickyHeader minWidth={560}>
            <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                  <Th>Бренд</Th>
                  <Th align="right">Позицій</Th>
                  <Th align="right">Замовити</Th>
                  <Th align="right">Нема на складі</Th>
                  <Th align="right">Сума, грн</Th>
                </tr>
              </thead>
              <tbody>
                {report.brands.slice(0, 12).map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => setBrandId(b.id)}
                    style={{ borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}
                    className="hover:bg-g50"
                  >
                    <Td>
                      <span className="font-semibold">{b.name}</span>
                    </Td>
                    <Td align="right">{b.total}</Td>
                    <Td align="right">
                      <b>{b.toOrder}</b>
                    </Td>
                    <Td align="right">
                      <span style={{ color: b.outOfStock > 0 ? "#B91C1C" : undefined }}>{b.outOfStock}</span>
                    </Td>
                    <Td align="right">{Math.round(b.orderCost).toLocaleString("uk-UA")}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          )}
        </Card>
      )}

      {report && visibleSections.length === 0 && (
        <EmptyState
          title="Нічого не знайдено"
          hint={search ? "Спробуйте інший запит або скиньте пошук." : "За цим фільтром позицій немає."}
        />
      )}

      {visibleSections.length > 0 && (
        <div className="flex items-center gap-3">
          <button onClick={addAllVisible} className="text-sm font-semibold text-blue-700 hover:underline">
            + Додати все видиме в заявку ({allVisible.filter((i) => i.severity < 3).length})
          </button>
        </div>
      )}

      {visibleSections.map((section) => (
        <Card key={section.name}>
          <div className="flex items-baseline justify-between gap-2 border-b border-g100 px-4 py-3">
            <h2 className="font-bold">{section.name}</h2>
            <span className="text-sm text-g400">
              позицій: {section.total} · замовити: <b className="text-bk">{section.toOrder}</b>
            </span>
          </div>
          <TableScroll minWidth={980} stickyHeader>
            <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                  <Th style={{ width: 34 }}> </Th>
                  <Th>Артикул</Th>
                  <Th style={{ width: "34%" }}>Назва</Th>
                  {!brandId && <Th>Бренд</Th>}
                  <Th align="right">Ціна</Th>
                  <Th align="right">Залишок</Th>
                  <Th align="right">Продажі/міс</Th>
                  <Th align="right">Вистачить</Th>
                  <Th align="right">Замовити</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody>
                {section.groups.map((group) => (
                  <GroupRows
                    key={`${brandId}:${section.name}:${group.name}`}
                    group={group}
                    showBrand={!brandId}
                    cart={cart}
                    onToggle={toggle}
                    onQty={setQty}
                    onOpen={setOpenId}
                  />
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ))}

      {openId && <ProductPanel id={openId} onClose={() => setOpenId(null)} />}

      {cartIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-g100 bg-white/95 p-3 shadow-lg backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-2">
            <span className="text-sm">
              У заявці: <b>{cartIds.length}</b> позицій на{" "}
              <b>{Math.round(cartSum).toLocaleString("uk-UA")} ₴</b>
            </span>
            <button onClick={() => setCart({})} className="text-sm text-g400 hover:text-bk">
              очистити
            </button>
            <button
              onClick={downloadCart}
              className="ml-auto h-10 rounded-[var(--radius-btn)] bg-bk px-5 text-sm font-semibold text-white hover:opacity-85"
            >
              ⬇ Завантажити заявку (Excel)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number | string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-g100 bg-white px-4 py-3">
      <div className="text-xs text-g400">{label}</div>
      <div className="text-xl font-bold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-g400">{hint}</div>}
    </div>
  );
}

function NumField({
  label, value, onChange, width = "w-24",
}: { label: string; value: number; onChange: (v: number) => void; width?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-g400">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || value)}
        className={`h-10 ${width} rounded-[var(--radius-btn)] border border-g100 px-3`}
      />
    </label>
  );
}

function Th({ children, align, style }: { children: React.ReactNode; align?: "right"; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: "10px 12px", textAlign: align ?? "left", fontWeight: 600, color: "#6B7280", fontSize: 12, ...style }}>
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return <td style={{ padding: "8px 12px", textAlign: align ?? "left" }}>{children}</td>;
}

function GroupRows({
  group, showBrand, cart, onToggle, onQty, onOpen,
}: {
  group: LowStockSection["groups"][number];
  showBrand: boolean;
  cart: Record<string, number>;
  onToggle: (item: LowStockItem) => void;
  onQty: (id: string, qty: number) => void;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const cols = showBrand ? 10 : 9;
  return (
    <>
      <tr onClick={() => setOpen((v) => !v)} style={{ background: "#EEF2FA", borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}>
        <td colSpan={cols} style={{ padding: "8px 12px", fontWeight: 600 }}>
          <span className="mr-2 inline-block w-3 text-g400">{open ? "▾" : "▸"}</span>
          {group.name}
          <span className="ml-2 text-xs font-normal text-g400">
            {group.total} поз. · замовити {group.toOrder}
          </span>
        </td>
      </tr>
      {open &&
        group.items.map((item) => {
          const inCart = cart[item.id] != null;
          return (
            <tr
              key={item.id}
              style={{
                background: inCart ? "#ECFDF5" : SEV_ROW[item.severity],
                borderBottom: "1px solid #F3F4F6",
              }}
            >
              <Td>
                <input type="checkbox" checked={inCart} onChange={() => onToggle(item)} />
              </Td>
              <Td>{item.sku ?? "—"}</Td>
              <td style={{ padding: "8px 12px" }}>
                <button
                  onClick={() => onOpen(item.id)}
                  className="text-left hover:underline"
                  title="Показати опис і фото"
                >
                  {item.name}
                </button>
              </td>
              {showBrand && <Td>{item.brandName}</Td>}
              <Td align="right">
                {item.price > 0 ? (
                  item.price.toLocaleString("uk-UA", { minimumFractionDigits: 2 })
                ) : (
                  // Ціна 0 = не приїхала з 1С. Показати «0,00» означало б збрехати
                  // про суму заявки — краще чесно сказати, що ціни немає.
                  <span title="Ціна не приїхала з 1С" className="text-g400">
                    нема ціни
                  </span>
                )}
              </Td>
              <Td align="right">
                <b>{item.stock}</b>
              </Td>
              <Td align="right">{item.perMonth || "—"}</Td>
              <Td align="right">
                {item.daysLeft == null ? (
                  "—"
                ) : (
                  <span style={{ color: item.daysLeft < 30 ? "#B91C1C" : undefined }}>{item.daysLeft} дн</span>
                )}
              </Td>
              <Td align="right">
                {inCart ? (
                  <input
                    type="number"
                    min={1}
                    value={cart[item.id]}
                    onChange={(e) => onQty(item.id, Number(e.target.value))}
                    className="h-8 w-20 rounded border border-g100 px-2 text-right"
                  />
                ) : (
                  <span className="text-g400">{item.suggested || "—"}</span>
                )}
              </Td>
              <Td>
                <span style={{ fontWeight: item.severity < 3 ? 700 : 400, color: SEV_COLOR[item.severity], fontSize: 12 }}>
                  {SEV_LABEL[item.severity]}
                </span>
              </Td>
            </tr>
          );
        })}
    </>
  );
}
