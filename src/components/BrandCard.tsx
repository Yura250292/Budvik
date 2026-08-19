"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import type { BrandInfo } from "@/lib/brands";

export default function BrandCard({ brand, count }: { brand: BrandInfo; count: number }) {
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      href={`/brand/${brand.slug}`}
      className="reveal group relative overflow-hidden rounded-xl border border-[#EFEFEF] hover:border-[#FFD600] active:scale-[0.98] transition-[box-shadow,border-color,transform] duration-300 ease-out-expo bg-white shadow-card hover:shadow-card-hover"
    >
      <div className="h-28 flex items-center justify-center p-4 bg-white">
        {brand.logo && !imgError ? (
          <Image
            src={brand.logo}
            alt={brand.name}
            width={120}
            height={64}
            className="max-h-16 max-w-[120px] object-contain group-hover:scale-105 transition-transform duration-200"
            onError={() => setImgError(true)}
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
