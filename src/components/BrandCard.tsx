"use client";

import Link from "next/link";
import { useState } from "react";
import type { BrandInfo } from "@/lib/brands";

export default function BrandCard({ brand, count }: { brand: BrandInfo; count: number }) {
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      href={`/catalog?brand=${brand.slug}`}
      className="group relative overflow-hidden rounded-xl border border-[#EFEFEF] hover:border-[#FFD600] transition-all duration-200 bg-white"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.06)' }}
    >
      <div className="h-28 flex items-center justify-center p-4 bg-white">
        {brand.logo && !imgError ? (
          <img
            src={brand.logo}
            alt={brand.name}
            className="max-h-16 max-w-[120px] object-contain group-hover:scale-105 transition-transform duration-200"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <span className="text-2xl font-black tracking-tight text-[#1A1A1A] group-hover:text-[#FFB800] transition-colors duration-200">
            {brand.name}
          </span>
        )}
      </div>
      <div className="bg-[#FAFAFA] px-3 py-2 text-center border-t border-[#EFEFEF]">
        <p className="text-xs text-[#9E9E9E] font-medium">{count} товарів</p>
      </div>
    </Link>
  );
}
