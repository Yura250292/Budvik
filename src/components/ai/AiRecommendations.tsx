"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  category?: { name: string };
}

interface AiRecommendationsProps {
  productId?: string;
  type: "similar" | "bought_together" | "personal";
  title: string;
}

export default function AiRecommendations({ productId, type, title }: AiRecommendationsProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ type });
    if (productId) params.set("productId", productId);

    fetch(`/api/ai/recommend?${params}`)
      .then((r) => r.json())
      .then((data) => setProducts(data.products || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [productId, type]);

  if (loading) {
    return (
      <div className="py-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">{title}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-gray-100 rounded-lg h-40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (products.length === 0) return null;

  return (
    <div className="py-6">
      <h3 className="text-xl font-bold text-gray-900 mb-4">{title}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {products.slice(0, 8).map((product) => (
          <Link
            key={product.id}
            href={`/catalog/${product.slug}`}
            className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md hover:border-orange-300 transition"
          >
            <span className="text-xs text-gray-500">{product.category?.name}</span>
            <h4 className="font-medium text-sm text-gray-900 mt-1 mb-2 line-clamp-2">{product.name}</h4>
            <span className="text-orange-600 font-bold">{formatPrice(product.price)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
