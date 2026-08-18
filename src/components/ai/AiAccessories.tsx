"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/utils";
import NoPhoto from "@/components/ui/NoPhoto";

interface Accessory {
  id: string;
  name: string;
  slug: string;
  price: number;
  image?: string | null;
  stock?: number;
  reason?: string;
  category?: { name: string };
}

export default function AiAccessories({ productId }: { productId: string }) {
  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/ai/accessories?productId=${productId}`)
      .then((r) => r.json())
      .then((data) => setAccessories(data.accessories || []))
      .catch(() => setAccessories([]))
      .finally(() => setLoading(false));
  }, [productId]);

  if (loading) {
    return (
      <div className="mt-10">
        <h3 className="text-xl font-bold text-bk mb-4">Сумісні аксесуари</h3>
        <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-g100 rounded-xl h-56 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (accessories.length === 0) return null;

  return (
    <div className="mt-10">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-sm">
          <svg className="w-4 h-4 text-bk" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-bk">Сумісні аксесуари та витратні матеріали</h3>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {accessories.map((acc) => (
          <Link
            key={acc.id}
            href={`/catalog/${acc.slug}`}
            className="bg-white border border-g200 rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/50 hover:-translate-y-0.5 active:scale-[0.98] transition-[box-shadow,border-color,transform] duration-150 group"
          >
            <div className="relative h-32 bg-g50 flex items-center justify-center">
              {acc.image ? (
                <Image src={acc.image} alt={acc.name} fill className="object-contain p-2" sizes="(max-width: 640px) 33vw, 25vw" />
              ) : (
                <NoPhoto size="sm" />
              )}
            </div>
            <div className="p-2.5">
              {acc.category && !/^\d+$/.test(acc.category.name) && (
                <span className="text-[10px] text-g400 uppercase tracking-wide">{acc.category.name}</span>
              )}
              <h4 className="font-medium text-xs text-bk group-hover:text-primary-dark transition line-clamp-2 mt-0.5 mb-1">
                {acc.name}
              </h4>
              {acc.reason && (
                <p className="text-[10px] text-g400 line-clamp-2 mb-1.5">{acc.reason}</p>
              )}
              <span className="text-sm font-bold text-bk">{formatPrice(acc.price)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
