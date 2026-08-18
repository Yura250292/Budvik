"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/utils";
import { isServiceCategory } from "@/lib/catalog/category-display";
import NoPhoto from "@/components/ui/NoPhoto";

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
        <h3 className="text-xl font-bold text-bk mb-4">{title}</h3>
        <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-g100 rounded-xl h-56 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (products.length === 0) return null;

  const icon = type === "bought_together" ? (
    <svg className="w-4 h-4 text-bk" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-bk" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );

  return (
    <div className="py-6">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-sm">
          {icon}
        </div>
        <h3 className="text-xl font-bold text-bk">{title}</h3>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {products.slice(0, 8).map((product) => (
          <Link
            key={product.id}
            href={`/catalog/${product.slug}`}
            className="bg-white border border-g200 rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/50 hover:-translate-y-0.5 active:scale-[0.98] transition-[box-shadow,border-color,transform] duration-150 group"
          >
            <div className="relative h-32 bg-g50 flex items-center justify-center">
              {product.image ? (
                <Image src={product.image} alt={product.name} fill className="object-contain p-2" sizes="(max-width: 640px) 33vw, 25vw" />
              ) : (
                <NoPhoto size="sm" />
              )}
            </div>
            <div className="p-2.5">
              {product.category && !isServiceCategory(product.category.name) && (
                <span className="text-[10px] text-g400 uppercase tracking-wide">{product.category.name}</span>
              )}
              <h4 className="font-medium text-xs text-bk group-hover:text-primary-dark transition line-clamp-2 mt-0.5 mb-1.5">
                {product.name}
              </h4>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-bk">{formatPrice(product.price)}</span>
                {product.stock > 0 ? (
                  <span className="text-[10px] text-green-600 font-medium">В наявності</span>
                ) : (
                  <span className="text-[10px] text-g400">Немає</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
