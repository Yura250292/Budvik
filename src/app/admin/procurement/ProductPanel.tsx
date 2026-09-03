"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";

/**
 * Панель товару: фото, опис, історія продажів, хто брав і звідки приходить.
 *
 * Висувається збоку, а не модалкою по центру: закупівельник відкриває картку
 * прямо посеред роботи зі списком, і список має лишатись перед очима —
 * інакше після закриття треба щоразу шукати, де він зупинився.
 *
 * Опис приходить із сервера вже як чистий текст (у базі він HTML із сайту
 * постачальника), тож рендериться звичайним <p>, без dangerouslySetInnerHTML.
 */

type Detail = {
  product: {
    id: string; sku: string | null; name: string; slug: string;
    description: string; image: string | null;
    price: number; stock: number;
    brandName: string | null; categoryName: string | null;
  };
  months: Array<{ month: string; sold: number }>;
  buyers: Array<{ name: string; sold: number; last: string }>;
  receipts: Array<{
    id: string;
    number: string;
    date: string;
    supplier: string;
    quantity: number;
    price: number;
  }>;
};

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });

const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

function monthLabel(m: string) {
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm) - 1] ?? mm} ${y.slice(2)}`;
}

export function ProductPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, isLoading } = useSWR<Detail>(`/api/admin/procurement/product?id=${id}`, fetcher);

  // Esc закриває — панель перекриває частину таблиці, і тягтися мишею до
  // хрестика посеред перебору сотні позицій незручно.
  useEffect(() => {
    // Слухач на document і в фазі capture: фокус лишається на кнопці в
    // таблиці, тож keydown на window міг і не дійти.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Портал на body: <main> адмінки має клас isolate (він тримає sticky-хедери
  // сторінок), а всередині такого контейнера position:fixed рахується від
  // нього, а не від вікна — панель зрізало згори на висоту шапки і вкладок.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const p = data?.product;
  const maxSold = Math.max(1, ...(data?.months ?? []).map((m) => m.sold));

  if (!mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-g100 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-g100 p-4">
          <div className="min-w-0">
            <div className="text-xs text-g400">
              {p?.brandName ?? "…"} {p?.sku ? `· ${p.sku}` : ""}
            </div>
            <h2 className="truncate text-base font-bold">{p?.name ?? "Завантаження…"}</h2>
          </div>
          <button onClick={onClose} className="shrink-0 rounded px-2 py-1 text-lg text-g400 hover:bg-g50 hover:text-bk">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && <div className="py-10 text-center text-sm text-g400">Завантаження…</div>}
          {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{String(error.message)}</div>}

          {p && (
            <div className="space-y-4">
              <div className="flex gap-4">
                {p.image ? (
                  // Звичайний <img>, а не next/image: домени картинок різні
                  // (budvik.com, prom.ua, cdn.27.ua), і оптимізатор на кожну
                  // таку картку робив би зайвий проксі-запит заради прев'ю.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image}
                    alt={p.name}
                    className="h-32 w-32 shrink-0 rounded-[var(--radius-card)] border border-g100 object-contain p-1"
                  />
                ) : (
                  <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-dashed border-g100 text-xs text-g400">
                    без фото
                  </div>
                )}
                <div className="min-w-0 space-y-1 text-sm">
                  <Row label="Ціна" value={p.price > 0 ? `${p.price.toLocaleString("uk-UA", { minimumFractionDigits: 2 })} ₴` : "нема ціни"} />
                  <Row label="Залишок" value={`${p.stock} шт`} strong={p.stock === 0} />
                  {p.categoryName && <Row label="Категорія" value={p.categoryName} />}
                </div>
              </div>

              {data.months.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-bold">Продажі за 6 місяців</h3>
                  {/*
                    maxWidth на стовпчику: коли продаж був лише в одному
                    місяці, flex-1 розтягував єдиний стовпчик на всю ширину
                    і графік читався як суцільна плита.
                  */}
                  <div className="flex items-end gap-1.5">
                    {data.months.map((m) => (
                      <div key={m.month} className="flex flex-1 flex-col items-center gap-1" style={{ maxWidth: 64 }}>
                        <span className="text-[11px] font-semibold">{m.sold}</span>
                        <div
                          className="w-full rounded-t bg-blue-500/70"
                          style={{ height: Math.max(4, (m.sold / maxSold) * 70) }}
                        />
                        <span className="text-[10px] text-g400">{monthLabel(m.month)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {data.buyers.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-bold">Хто брав (6 місяців)</h3>
                  <ul className="space-y-1 text-sm">
                    {data.buyers.map((b) => (
                      <li key={b.name} className="flex justify-between gap-3 border-b border-g100 pb-1">
                        <span className="truncate">{b.name}</span>
                        <span className="shrink-0 text-g400">
                          {b.sold} шт · {new Date(b.last).toLocaleDateString("uk-UA")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(data.receipts?.length ?? 0) > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-bold">Останні надходження</h3>
                  <ul className="space-y-1 text-sm">
                    {data.receipts.map((r) => (
                      <li key={r.id + r.number} className="flex justify-between gap-3 border-b border-g100 pb-1">
                        <a
                          href={`/admin/erp/purchase-orders/${r.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-blue-700 hover:underline"
                          title={`Накладна ${r.number}`}
                        >
                          {r.supplier}
                        </a>
                        <span className="shrink-0 text-g400">
                          {r.quantity} шт ×{" "}
                          {r.price.toLocaleString("uk-UA", { minimumFractionDigits: 2 })} ₴ ·{" "}
                          {new Date(r.date).toLocaleDateString("uk-UA")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-sm font-bold">Опис</h3>
                {p.description ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-g600">{p.description}</p>
                ) : (
                  <p className="text-sm text-g400">Опису немає — не приїхав із сайту постачальника.</p>
                )}
              </section>

              <a
                href={`/catalog/${p.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm font-semibold text-blue-700 hover:underline"
              >
                Відкрити картку в магазині ↗
              </a>
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-g400">{label}</span>
      <span className={strong ? "font-bold text-red-700" : "font-medium"}>{value}</span>
    </div>
  );
}
