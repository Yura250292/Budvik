"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import SwipeToCart from "@/components/catalog/SwipeToCart";
import { isRealSku } from "@/lib/catalog/sku-search";
import { getCart, addToCart, updateCartQty, getCartTotal, getCartCount, type CartItem } from "@/lib/cart";

interface Product {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  price: number;
  stock: number;
  image: string | null;
  brand?: { name: string } | null;
}

/**
 * Список товарів у режимі показу клієнту — з набором замовлення.
 *
 * Два вигляди, бо в полі потрібні обидва: «Список» — щоб швидко знайти
 * позицію й назвати ціну, «Фото» — щоб розвернути планшет до клієнта.
 *
 * Додавання в кошик жестом, а не кнопкою: торговий тримає планшет однією
 * рукою, і свайп через увесь рядок не вимагає прицілювання. Кнопка «+»
 * лишається для миші й для тих, кому жест незручний.
 *
 * Кошик той самий, що й у магазині (lib/cart) — окремий «кошик торгового»
 * означав би дві різні корзини в одному застосунку і питання, з якої саме
 * оформлюється замовлення.
 */
export default function SalesProductList({ products }: { products: Product[] }) {
  const [view, setView] = useState<"list" | "photo">("list");
  const [cart, setCart] = useState<CartItem[]>([]);

  // Кошик живе в localStorage і змінюється з інших вкладок та сторінок,
  // тож слухаємо подію, а не читаємо раз при монтуванні.
  useEffect(() => {
    const sync = () => setCart(getCart());
    sync();
    window.addEventListener("cart-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("cart-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const qtyOf = useCallback(
    (id: string) => cart.find((i) => i.productId === id)?.quantity ?? 0,
    [cart]
  );

  const add = useCallback((p: Product, qty = 1) => {
    addToCart(
      { productId: p.id, name: p.name, price: p.price, slug: p.slug, image: p.image },
      qty
    );
  }, []);

  const total = getCartTotal(cart);
  const count = getCartCount(cart);

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

      <p className="mb-2 flex items-center gap-1.5 text-[11px] text-g400 md:hidden">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
        Проведіть по товару вправо, щоб додати в кошик
      </p>

      {view === "list" ? (
        <div className="overflow-hidden rounded-xl border border-g100 bg-white">
          {products.map((p, i) => {
            const qty = qtyOf(p.id);
            return (
              <SwipeToCart key={p.id} onAdd={() => add(p)} disabled={!p.price}>
                <div className={`flex items-center gap-3 px-3 py-3 ${i > 0 ? "border-t border-g100" : ""}`}>
                  <Thumb src={p.image} alt={p.name} size={48} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/catalog/${p.slug}`} className="line-clamp-2 text-sm leading-snug text-[#0A0A0A]">
                      {p.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-g400">
                      {isRealSku(p.sku) && <span>Арт. {p.sku}</span>}
                      <StockTag stock={p.stock} />
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                    <Price value={p.price} />
                    <QtyControl
                      qty={qty}
                      disabled={!p.price}
                      onAdd={() => add(p)}
                      onSet={(n) => updateCartQty(p.id, n)}
                    />
                  </div>
                </div>
              </SwipeToCart>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          {products.map((p) => {
            const qty = qtyOf(p.id);
            return (
              <div key={p.id} className="overflow-hidden rounded-xl border border-g100 bg-white">
                <Link href={`/catalog/${p.slug}`} className="relative block aspect-square bg-g50">
                  <Thumb src={p.image} alt={p.name} fill />
                </Link>
                <div className="p-2.5">
                  <div className="line-clamp-2 min-h-[2.5rem] text-xs leading-snug text-[#0A0A0A]">
                    {p.name}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <Price value={p.price} />
                    <StockTag stock={p.stock} />
                  </div>
                  <div className="mt-2">
                    <QtyControl
                      qty={qty}
                      wide
                      disabled={!p.price}
                      onAdd={() => add(p)}
                      onSet={(n) => updateCartQty(p.id, n)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/*
        Відступ під панель кошика: вона fixed, і без цього накриває останні
        рядки списку — саме ті, до яких торговий догортав.
      */}
      {count > 0 && <div className="h-20" aria-hidden />}

      {/* Панель кошика — липне до низу, поверх нижнього меню торгового */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-40 border-t border-g200 bg-white px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.12)]">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-g500">
                {count} {plural(count, "позиція", "позиції", "позицій")}
              </div>
              <div className="text-lg font-bold leading-tight text-[#0A0A0A]">
                {total.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} ₴
              </div>
            </div>
            <Link
              href="/cart"
              className="flex min-h-12 flex-shrink-0 items-center rounded-[10px] bg-[#FFD600] px-6 text-sm font-bold text-[#0A0A0A] active:bg-[#FFC400]"
            >
              Кошик →
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

/** «5 позицій», «2 позиції» — інакше сума виглядає як недописаний рядок. */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function QtyControl({
  qty,
  onAdd,
  onSet,
  disabled,
  wide,
}: {
  qty: number;
  onAdd: () => void;
  onSet: (n: number) => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  if (disabled) return null;

  if (qty === 0) {
    return (
      <button
        onClick={onAdd}
        aria-label="Додати в кошик"
        className={`flex min-h-9 items-center justify-center rounded-lg bg-[#FFD600] font-bold text-[#0A0A0A] active:bg-[#FFC400] ${
          wide ? "w-full text-xs" : "w-9 text-lg"
        }`}
      >
        {wide ? "У кошик" : "+"}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-1 ${wide ? "w-full" : ""}`}>
      <button
        onClick={() => onSet(qty - 1)}
        aria-label="Менше"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-g300 text-lg font-bold text-[#1A1A1A] active:bg-g50"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={qty}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onSet(Number.isFinite(n) ? Math.max(0, n) : 0);
        }}
        aria-label="Кількість"
        className={`h-9 rounded-lg border border-g300 text-center text-sm font-semibold text-[#0A0A0A] outline-none focus:border-[#FFD600] ${
          wide ? "min-w-0 flex-1" : "w-12"
        }`}
      />
      <button
        onClick={onAdd}
        aria-label="Більше"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#FFD600] text-lg font-bold text-[#0A0A0A] active:bg-[#FFC400]"
      >
        +
      </button>
    </div>
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

/**
 * Залишок словами й числом.
 *
 * «Мало» окремо від «є»: коли на складі три штуки, торговий має це бачити
 * до того, як пообіцяє клієнту двадцять.
 */
function StockTag({ stock }: { stock: number }) {
  if (stock <= 0) {
    return (
      <span className="whitespace-nowrap rounded bg-g100 px-1.5 py-0.5 text-[10px] font-medium text-g500">
        під замовлення
      </span>
    );
  }
  if (stock <= 5) {
    return (
      <span className="whitespace-nowrap rounded bg-[#B45309]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#B45309]">
        залишок {stock}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap rounded bg-[#15803D]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#15803D]">
      є {stock}
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
