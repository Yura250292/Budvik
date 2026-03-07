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
  image?: string | null;
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-gray-100 rounded-xl h-56 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (products.length === 0) return null;

  const icon = type === "bought_together" ? (
    <svg className="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );

  return (
    <div className="py-6">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center shadow-sm">
          {icon}
        </div>
        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {products.slice(0, 8).map((product) => (
          <Link
            key={product.id}
            href={`/catalog/${product.slug}`}
            className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-lg hover:border-yellow-400/50 hover:-translate-y-0.5 transition-all duration-200 group"
          >
            <div className="h-32 bg-gray-50 flex items-center justify-center">
              {product.image ? (
                <img src={product.image} alt={product.name} className="h-full w-full object-contain p-2" loading="lazy" />
              ) : (
                <svg className="w-10 h-10 text-gray-300 group-hover:text-yellow-300 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              )}
            </div>
            <div className="p-2.5">
              {product.category && !/^\d+$/.test(product.category.name) && (
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">{product.category.name}</span>
              )}
              <h4 className="font-medium text-xs text-gray-900 group-hover:text-yellow-600 transition line-clamp-2 mt-0.5 mb-1.5">
                {product.name}
              </h4>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900">{formatPrice(product.price)}</span>
                {product.stock > 0 ? (
                  <span className="text-[10px] text-green-600 font-medium">В наявності</span>
                ) : (
                  <span className="text-[10px] text-gray-400">Немає</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
