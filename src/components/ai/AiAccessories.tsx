"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

interface Accessory {
  id: string;
  name: string;
  slug: string;
  price: number;
  reason?: string;
  category?: { name: string };
}

export default function AiAccessories({ productId }: { productId: string }) {
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/ai/accessories?productId=${productId}`)
      .then((r) => r.json())
      .then((data) => setAccessories(data.accessories || []))
      .catch(() => setAccessories([]))
      .finally(() => setLoading(false));
  }, [productId]);

  if (loading) {
    return (
      <div className="mt-8">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Сумісні аксесуари</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-gray-100 rounded-lg h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (accessories.length === 0) return null;

  return (
    <div className="mt-8">
      <h3 className="text-xl font-bold text-gray-900 mb-4">Сумісні аксесуари та витратні матеріали</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {accessories.map((acc) => (
          <Link
            key={acc.id}
            href={`/catalog/${acc.slug}`}
            className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md hover:border-yellow-400 transition"
          >
            <span className="text-xs text-gray-500">{acc.category?.name}</span>
            <h4 className="font-medium text-sm text-gray-900 mt-1 mb-1 line-clamp-2">{acc.name}</h4>
            {acc.reason && (
              <p className="text-xs text-gray-500 mb-2 line-clamp-2">{acc.reason}</p>
            )}
            <span className="text-gray-900 font-bold text-sm">{formatPrice(acc.price)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
