"use client";

import { useState } from "react";
import { addToCart } from "@/lib/cart";
import { flyToCart } from "@/lib/fly-to-cart";
import { packLabel, stepPack, roundUpToPack } from "@/lib/pack-qty";

export default function AddToCartButton({ productId, name, price, slug, image, packQty }: {
  productId: string; name: string; price: number; slug: string; image?: string | null;
  packQty?: number | null;
}) {
  const pack = packQty && packQty > 1 ? packQty : 1;
  // Товар із кратністю не можна взяти поштучно — стартуємо з однієї пачки.
  const [qty, setQty] = useState(pack);
  const [added, setAdded] = useState(false);

  const handleAdd = (e: React.MouseEvent) => {
    flyToCart(e.currentTarget as HTMLElement);
    addToCart({ productId, name, price, slug, image, packQty: pack }, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const label = packLabel(pack, name);

  return (
    <div>
      {label && (
        <p className="mb-2 text-sm text-g500">
          <span className="font-medium text-g700">{label}.</span>{" "}
          Замовлення кратне {pack}.
        </p>
      )}
      <div className="flex items-center gap-4">
        <div className="flex items-center border border-g300 rounded-lg">
          <button
            onClick={() => setQty(stepPack(qty, pack, -1))}
            className="px-3 py-2 hover:bg-g100 transition"
            aria-label="Зменшити кількість"
          >
            -
          </button>
          <span className="px-4 py-2 font-medium">{qty}</span>
          <button
            onClick={() => setQty(stepPack(qty, pack, 1))}
            className="px-3 py-2 hover:bg-g100 transition"
            aria-label="Збільшити кількість"
          >
            +
          </button>
        </div>
        <button
          onClick={handleAdd}
          className={`flex-1 py-3 font-semibold transition ${
            added
              ? "bg-green-500 text-white rounded-[10px]"
              : "btn-primary shadow-lg shadow-primary/20"
          }`}
        >
          {added ? "Додано!" : "Додати в кошик"}
        </button>
      </div>
      {pack > 1 && qty !== roundUpToPack(qty, pack) && (
        <p className="mt-2 text-sm text-red-500">Кількість буде округлено до {roundUpToPack(qty, pack)}.</p>
      )}
    </div>
  );
}
