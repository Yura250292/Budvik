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
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
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
            className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
          />
        </div>
        <button
          onClick={search}
          disabled={loading}
          className="bg-yellow-400 text-black font-semibold px-6 py-3 rounded-lg hover:bg-yellow-300 disabled:opacity-50 transition font-medium"
        >
          {loading ? "..." : "AI Пошук"}
        </button>
      </div>

      {searchType && (
        <div className="mb-3">
          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">
            {searchType === "semantic" ? "Семантичний пошук" : searchType === "keyword" ? "Текстовий пошук" : "Пошук"}
          </span>
          <span className="text-sm text-gray-500 ml-2">
            Знайдено {results.length} товарів
          </span>
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-gray-500">
          <div className="animate-spin w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full mx-auto mb-2" />
          AI аналізує ваш запит...
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          Нічого не знайдено. Спробуйте інший запит.
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((product) => (
            <Link
              key={product.id}
              href={`/catalog/${product.slug}`}
              className="group"
            >
              <div className={`border rounded-lg overflow-hidden transition-shadow ${
                product.stock > 0
                  ? "border-gray-200 hover:shadow-lg bg-white"
                  : "border-gray-200 bg-gray-50 opacity-60"
              }`}>
                <div className={`h-48 flex items-center justify-center ${
                  product.stock > 0 ? "bg-gray-100" : "bg-gray-200"
                }`}>
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.name}
                      className="h-full w-full object-contain p-2"
                      loading="lazy"
                    />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`h-20 w-20 transition ${
                        product.stock > 0 ? "text-gray-300 group-hover:text-yellow-300" : "text-gray-300"
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
                    <span className="text-xs text-gray-500 mb-1 block">{product.category.name}</span>
                  )}
                  <h3 className={`font-semibold mb-1 line-clamp-2 transition ${
                    product.stock > 0 ? "text-gray-900 group-hover:text-yellow-600" : "text-gray-400"
                  }`}>
                    {product.name}
                  </h3>
                  <p className="text-sm text-gray-500 mb-3 line-clamp-2">{product.description}</p>
                  <div className="flex items-center justify-between">
                    <span className={`text-lg font-bold ${
                      product.stock > 0 ? "text-gray-900" : "text-gray-400"
                    }`}>
                      {formatPrice(product.price)}
                    </span>
                    {product.stock > 0 ? (
                      <button
                        onClick={(e) => handleAddToCart(e, product)}
                        className="bg-yellow-400 text-black font-semibold px-3 py-1.5 rounded text-sm hover:bg-yellow-300 transition"
                      >
                        У кошик
                      </button>
                    ) : (
                      <span className="text-sm text-gray-400 font-medium">Немає в наявності</span>
                    )}
                  </div>
                  {product.stock > 0 && product.stock <= 5 && (
                    <p className="text-xs text-yellow-600 mt-2">Залишилось {product.stock} шт.</p>
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
