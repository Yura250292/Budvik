"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
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
            className="w-full border border-gray-300 rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
          />
        </div>
        <button
          onClick={search}
          disabled={loading}
          className="bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-500 disabled:opacity-50 transition font-medium"
        >
          {loading ? "..." : "AI Пошук"}
        </button>
      </div>

      {searchType && (
        <div className="mb-3">
          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
            {searchType === "semantic" ? "Семантичний пошук" : searchType === "keyword" ? "Текстовий пошук" : "Пошук"}
          </span>
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-gray-500">
          <div className="animate-spin w-8 h-8 border-2 border-orange-600 border-t-transparent rounded-full mx-auto mb-2" />
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
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md hover:border-orange-300 transition"
            >
              <span className="text-xs text-gray-500">{product.category?.name}</span>
              <h3 className="font-semibold text-gray-900 mt-1 mb-2 line-clamp-2">{product.name}</h3>
              <p className="text-sm text-gray-500 mb-3 line-clamp-2">{product.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-orange-600">{formatPrice(product.price)}</span>
                {product.stock > 0 ? (
                  <span className="text-xs text-green-600">В наявності</span>
                ) : (
                  <span className="text-xs text-red-500">Немає</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
