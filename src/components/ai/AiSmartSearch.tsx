"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { addToCart } from "@/lib/cart";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  image?: string | null;
  stock: number;
  category: { name: string };
}

export default function AiSmartSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchType, setSearchType] = useState("");
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch(`/api/ai/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setResults(data.products || []);
      setSearchType(data.type || "");
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") search();
  };

  const handleAddToCart = (e: React.MouseEvent, product: Product) => {
    e.preventDefault();
    addToCart({ productId: product.id, name: product.name, price: product.price, slug: product.slug });
  };

  return (
    <div className="w-full">
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9E9E9E]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Розумний пошук: наприклад 'дриль для бетону' або 'недорога болгарка'"
            className="w-full bg-white border border-[#E0E0E0] rounded-[10px] pl-11 pr-4 py-3 text-[#0A0A0A] placeholder-[#9E9E9E] transition duration-200"
            style={{ height: '44px' }}
          />
        </div>
        <button
          onClick={search}
          disabled={loading}
          className="bg-[#FFD600] text-[#0A0A0A] font-semibold px-6 rounded-[10px] hover:bg-[#FFC400] disabled:opacity-50 transition duration-200 hover:-translate-y-px"
          style={{ height: '44px' }}
        >
          {loading ? "..." : "AI Пошук"}
        </button>
      </div>

      {searchType && (
        <div className="mb-4">
          <span className="text-xs bg-[#FFD600]/15 text-[#0A0A0A] px-2.5 py-1 rounded-md font-medium">
            {searchType === "semantic" ? "Семантичний пошук" : searchType === "keyword" ? "Текстовий пошук" : "Пошук"}
          </span>
          <span className="text-sm text-[#9E9E9E] ml-2">
            Знайдено {results.length} товарів
          </span>
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-[#9E9E9E]">
          <div className="animate-spin w-8 h-8 border-2 border-[#FFD600] border-t-transparent rounded-full mx-auto mb-2" />
          AI аналізує ваш запит...
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-8 text-[#9E9E9E]">
          Нічого не знайдено. Спробуйте інший запит.
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
          {results.map((product) => (
            <Link
              key={product.id}
              href={`/catalog/${product.slug}`}
              className="group"
            >
              <div className={`rounded-xl overflow-hidden transition-all duration-200 border ${
                product.stock > 0
                  ? "border-[#EFEFEF] bg-white hover:shadow-[0_10px_30px_rgba(0,0,0,0.12)] hover:-translate-y-1"
                  : "border-[#EFEFEF] bg-[#FAFAFA] opacity-60"
              }`}
                style={{ boxShadow: product.stock > 0 ? '0 1px 3px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.06)' : 'none' }}
              >
                <div className={`h-48 flex items-center justify-center ${
                  product.stock > 0 ? "bg-[#FAFAFA]" : "bg-[#EFEFEF]"
                }`}>
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.name}
                      className="h-full w-full object-contain p-2.5"
                      loading="lazy"
                    />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`h-20 w-20 transition duration-200 ${
                        product.stock > 0 ? "text-[#DADADA] group-hover:text-[#FFD600]" : "text-[#DADADA]"
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  )}
                </div>

                <div className="p-4">
                  {product.category && (
                    <span className="inline-block text-xs text-[#9E9E9E] bg-[#F0F0F0] px-2 py-0.5 rounded-md mb-2 font-medium">{product.category.name}</span>
                  )}
                  <h3 className={`text-[15px] font-semibold mb-1.5 line-clamp-2 transition duration-200 leading-snug ${
                    product.stock > 0 ? "text-[#0A0A0A] group-hover:text-[#FFB800]" : "text-[#9E9E9E]"
                  }`}>
                    {product.name}
                  </h3>
                  <p className="text-sm text-[#555] mb-3 line-clamp-2 leading-relaxed">{product.description}</p>
                  <div className="flex items-center justify-between">
                    <span className={`text-xl font-bold ${
                      product.stock > 0 ? "text-[#0A0A0A]" : "text-[#9E9E9E]"
                    }`}>
                      {formatPrice(product.price)}
                    </span>
                    {product.stock > 0 ? (
                      <button
                        onClick={(e) => handleAddToCart(e, product)}
                        className="bg-[#FFD600] text-[#0A0A0A] px-4 py-2 rounded-[10px] text-sm font-semibold hover:bg-[#FFC400] hover:-translate-y-px transition-all duration-200"
                        style={{ height: '40px' }}
                      >
                        У кошик
                      </button>
                    ) : (
                      <span className="text-sm text-[#9E9E9E] font-medium">Немає в наявності</span>
                    )}
                  </div>
                  {product.stock > 0 && product.stock <= 5 && (
                    <p className="text-xs text-[#FFB800] mt-2 font-medium">Залишилось {product.stock} шт.</p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
