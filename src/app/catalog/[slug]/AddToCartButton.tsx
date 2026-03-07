"use client";

import { useState } from "react";
import { addToCart } from "@/lib/cart";

export default function AddToCartButton({ productId, name, price, slug }: {
  productId: string; name: string; price: number; slug: string;
}) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    addToCart({ productId, name, price, slug }, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center border border-gray-300 rounded-lg">
        <button
          onClick={() => setQty(Math.max(1, qty - 1))}
          className="px-3 py-2 hover:bg-gray-100 transition"
        >
          -
        </button>
        <span className="px-4 py-2 font-medium">{qty}</span>
        <button
          onClick={() => setQty(qty + 1)}
          className="px-3 py-2 hover:bg-gray-100 transition"
        >
          +
        </button>
      </div>
      <button
        onClick={handleAdd}
        className={`flex-1 py-3 rounded-lg font-semibold transition ${
          added
            ? "bg-green-500 text-white"
            : "bg-orange-600 text-white hover:bg-orange-500"
        }`}
      >
        {added ? "Додано!" : "Додати в кошик"}
      </button>
    </div>
  );
}
