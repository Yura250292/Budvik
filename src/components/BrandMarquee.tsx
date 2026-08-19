import Image from "next/image";
import Link from "next/link";
import type { BrandInfo } from "@/lib/brands";

/*
 * Стрічка логотипів брендів, що повільно пливе на чорній смузі —
 * серверний компонент, рух дає існуюча keyframes marquee (зсув на -50%),
 * тож ряд дубльовано і цикл безшовний. Дублікати сховані від скрінрідера
 * і вийняті з tab-порядку — це та сама навігація ще раз.
 */
export default function BrandMarquee({ brands }: { brands: BrandInfo[] }) {
  if (brands.length < 4) return null;
  const row = [...brands, ...brands];
  return (
    <section className="bg-[#0A0A0A] py-5 overflow-hidden" aria-label="Бренди в асортименті">
      <div className="animate-marquee flex w-max items-center gap-12 hover:[animation-play-state:paused]">
        {row.map((b, i) => {
          const isClone = i >= brands.length;
          return (
            <Link
              key={`${b.slug}-${i}`}
              href={`/brand/${b.slug}`}
              className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity duration-300"
              tabIndex={isClone ? -1 : undefined}
              aria-hidden={isClone || undefined}
            >
              {b.logo ? (
                <Image
                  src={b.logo}
                  alt={isClone ? "" : b.name}
                  width={110}
                  height={40}
                  className="h-8 w-auto object-contain brightness-0 invert"
                />
              ) : (
                <span className="text-white font-black text-lg tracking-tight whitespace-nowrap">
                  {b.name}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
