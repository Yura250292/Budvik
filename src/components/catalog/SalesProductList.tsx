"use client";

import { useState } from "react";
import Image from "next/image";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  stock: number;
  image: string | null;
  brand?: { name: string } | null;
}

/**
 * Список товарів у режимі показу клієнту.
 *
 * Два вигляди, бо в полі потрібні обидва: «Список» — щоб швидко знайти
 * позицію й назвати ціну, «Фото» — щоб розвернути планшет до клієнта і
 * показати товар. Це те, заради чого возять паперові каталоги, тож картинка
 * має бути великою, а не мініатюрою в кутку рядка.
 */
export default function SalesProductList({ products }: { products: Product[] }) {
  const [view, setView] = useState<"list" | "photo">("list");

  return (
    <>
      <div className="mb-2 flex items-center justify-end gap-1">
        <span className="mr-1 text-xs text-g400">Вигляд:</span>
        {(
          [
            { v: "list" as const, label: "Список" },
            { v: "photo" as const, label: "Фото" },
          ]
        ).map((o) => (
          <button
            key={o.v}
            onClick={() => setView(o.v)}
            className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition ${
              view === o.v ? "bg-[#0A0A0A] text-[#FFD600]" : "bg-g100 text-g500"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {view === "list" ? (
        <div className="overflow-hidden rounded-xl border border-g100 bg-white">
          {products.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 px-3 py-3 ${i > 0 ? "border-t border-g100" : ""}`}
            >
              <Thumb src={p.image} alt={p.name} size={48} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm leading-snug text-[#0A0A0A]">{p.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-g400">
                  {p.sku && <span>Арт. {p.sku}</span>}
                  <StockTag stock={p.stock} />
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <Price value={p.price} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {products.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border border-g100 bg-white">
              <div className="relative aspect-square bg-g50">
                <Thumb src={p.image} alt={p.name} fill />
              </div>
              <div className="p-2.5">
                <div className="line-clamp-2 min-h-[2.5rem] text-xs leading-snug text-[#0A0A0A]">
                  {p.name}
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <Price value={p.price} />
                  <StockTag stock={p.stock} />
                </div>
                {p.sku && <div className="mt-1 text-[10px] text-g400">Арт. {p.sku}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Price({ value }: { value: number }) {
  // Ціна 0 означає, що вона не приїхала з 1С, а не що товар безкоштовний —
  // показати «0 ₴» клієнту було б гірше, ніж не показати нічого.
  if (!value) return <span className="text-xs text-g400">ціну уточнюйте</span>;
  return (
    <span className="whitespace-nowrap text-sm font-bold text-[#0A0A0A]">
      {value.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴
    </span>
  );
}

function StockTag({ stock }: { stock: number }) {
  if (stock > 0) {
    return (
      <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#15803D] bg-[#15803D]/10">
        є {stock}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap rounded bg-g100 px-1.5 py-0.5 text-[10px] font-medium text-g500">
      під замовлення
    </span>
  );
}

function Thumb({
  src,
  alt,
  size,
  fill,
}: {
  src: string | null;
  alt: string;
  size?: number;
  fill?: boolean;
}) {
  if (!src) {
    return fill ? (
      <div className="flex h-full w-full items-center justify-center text-2xl text-g300">📦</div>
    ) : (
      <div
        className="flex flex-shrink-0 items-center justify-center rounded-lg bg-g50 text-lg text-g300"
        style={{ width: size, height: size }}
      >
        📦
      </div>
    );
  }

  if (fill) {
    return <Image src={src} alt={alt} fill sizes="50vw" className="object-contain p-2" />;
  }

  return (
    <div
      className="flex-shrink-0 overflow-hidden rounded-lg border border-g100 bg-white"
      style={{ width: size, height: size }}
    >
      <Image src={src} alt={alt} width={size} height={size} className="h-full w-full object-contain" />
    </div>
  );
}
