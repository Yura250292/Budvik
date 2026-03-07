"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { addToCart } from "@/lib/cart";

interface ProductCardProps {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  image?: string | null;
  category?: { name: string };
}

export default function ProductCard({ id, name, slug, description, price, stock, image, category }: ProductCardProps) {
  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    addToCart({ productId: id, name, price, slug });
  };

  return (
    <Link href={`/catalog/${slug}`} className="group">
      <div className={`border rounded-lg overflow-hidden transition-shadow ${
        stock > 0 ? "border-gray-200 hover:shadow-lg bg-white" : "border-gray-200 bg-gray-50 opacity-60"
      }`}>
        <div className={`h-48 flex items-center justify-center ${stock > 0 ? "bg-gray-100" : "bg-gray-200"}`}>
          {image ? (
            <img
              src={image}
              alt={name}
              className="h-full w-full object-contain p-2"
              loading="lazy"
            />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-20 w-20 transition ${
              stock > 0 ? "text-gray-300 group-hover:text-orange-300" : "text-gray-300"
            }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          )}
        </div>
        <div className="p-4">
          {category && (
            <span className="text-xs text-gray-500 mb-1 block">{category.name}</span>
          )}
          <h3 className={`font-semibold mb-1 line-clamp-2 transition ${
            stock > 0 ? "text-gray-900 group-hover:text-orange-600" : "text-gray-400"
          }`}>
            {name}
          </h3>
          <p className="text-sm text-gray-500 mb-3 line-clamp-2">{description}</p>
          <div className="flex items-center justify-between">
            <span className={`text-lg font-bold ${stock > 0 ? "text-orange-600" : "text-gray-400"}`}>
              {formatPrice(price)}
            </span>
            {stock > 0 ? (
              <button
                onClick={handleAddToCart}
                className="bg-orange-500 text-white px-3 py-1.5 rounded text-sm hover:bg-orange-600 transition"
              >
                У кошик
              </button>
            ) : (
              <span className="text-sm text-gray-400 font-medium">Немає в наявності</span>
            )}
          </div>
          {stock > 0 && stock <= 5 && (
            <p className="text-xs text-orange-500 mt-2">Залишилось {stock} шт.</p>
          )}
        </div>
      </div>
    </Link>
  );
}
