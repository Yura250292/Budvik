"use client";

import Link from "next/link";
import { useState } from "react";
import type { BrandInfo } from "@/lib/brands";

export default function BrandCard({ brand, count }: { brand: BrandInfo; count: number }) {
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      href={`/catalog?brand=${brand.slug}`}
      className="group relative overflow-hidden rounded-xl border border-gray-200 hover:shadow-xl hover:border-yellow-400 transition-all duration-300 bg-white"
    >
      <div className="h-28 flex items-center justify-center p-4">
        {brand.logo && !imgError ? (
          <img
            src={brand.logo}
            alt={brand.name}
            className="max-h-16 max-w-[120px] object-contain group-hover:scale-110 transition-transform duration-300"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <span className={`text-2xl font-black tracking-tight ${
            brand.color === "bg-yellow-400" || brand.color === "bg-yellow-500"
              ? "text-gray-900"
              : "text-gray-800"
          } group-hover:text-yellow-600 transition-colors`}>
            {brand.name}
          </span>
        )}
      </div>
      <div className="bg-gray-50 px-3 py-2 text-center border-t">
        <p className="text-xs text-gray-500">{count} товарів</p>
      </div>
    </Link>
  );
}
