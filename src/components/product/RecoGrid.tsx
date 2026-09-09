/**
 * Сітка рекомендованих товарів на картці.
 *
 * Серверний компонент, а не клієнтський fetch: блоки збирає
 * `productRecommendations` разом зі сторінкою, тож вони приїжджають уже
 * намальованими, живуть в ISR-кеші картки й не блимають скелетоном.
 *
 * Дві колонки на телефоні, чотири на екрані — рівно під чотири картки блоку.
 * Було три на телефоні, і четверта висла сиротою в другому ряду.
 */

import Link from "next/link";
import Image from "next/image";
import NoPhoto from "@/components/ui/NoPhoto";
import { formatPrice } from "@/lib/utils";
import type { Reco } from "@/lib/catalog/recommendations";

export default function RecoGrid({
  title,
  items,
  icon,
}: {
  title: string;
  items: Reco[];
  icon: "together" | "sizes";
}) {
  if (items.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-bk-muted to-bk shadow-sm">
          <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {icon === "together" ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            )}
          </svg>
        </div>
        <h2 className="text-xl font-bold text-bk">{title}</h2>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {items.map((p) => (
          <Link
            key={p.id}
            href={`/catalog/${p.slug}`}
            className="group overflow-hidden rounded-xl border border-g200 bg-white transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg active:scale-[0.98]"
          >
            <div className="relative flex h-32 items-center justify-center bg-g50">
              {p.image ? (
                <Image
                  src={p.image}
                  alt={p.name}
                  fill
                  className="object-contain p-2"
                  sizes="(max-width: 640px) 50vw, 25vw"
                />
              ) : (
                <NoPhoto label={null} size="sm" />
              )}
            </div>
            <div className="p-2.5">
              <h3 className="mb-1.5 line-clamp-2 text-xs font-medium text-bk transition group-hover:text-primary-dark">
                {p.name}
              </h3>
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-sm font-bold text-bk">{formatPrice(p.price)}</span>
                {p.stock > 0 ? (
                  <span className="text-[10px] font-medium text-green-700">В наявності</span>
                ) : (
                  <span className="text-[10px] text-g400">Немає</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
