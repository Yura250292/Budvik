"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { formatPrice } from "@/lib/utils";

/*
 * Драг-стрічка товарів: тягнеться мишкою/пальцем з інерцією (motion drag).
 * Клік після перетягування гаситься, інакше відпускання стрічки
 * відкривало б випадкову картку.
 */

export type StripProduct = { slug: string; name: string; image: string; price: number };

export default function ProductStrip({ products }: { products: StripProduct[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [limit, setLimit] = useState(0);

  useEffect(() => {
    const measure = () => {
      const w = wrapRef.current?.offsetWidth ?? 0;
      const iw = innerRef.current?.scrollWidth ?? 0;
      setLimit(Math.max(0, iw - w));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [products.length]);

  return (
    <div ref={wrapRef} className="cursor-grab overflow-hidden active:cursor-grabbing">
      <motion.div
        ref={innerRef}
        drag="x"
        dragConstraints={{ left: -limit, right: 0 }}
        onDragStart={() => { draggingRef.current = true; }}
        onDragEnd={() => { window.setTimeout(() => { draggingRef.current = false; }, 60); }}
        className="flex w-max gap-4 pb-2 sm:gap-6"
      >
        {products.map((p) => (
          <motion.div
            key={p.slug}
            whileHover={{ scale: 1.04, y: -6 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="w-52 shrink-0 sm:w-64"
          >
            <Link
              href={`/catalog/${p.slug}`}
              draggable={false}
              onClick={(e) => { if (draggingRef.current) e.preventDefault(); }}
              className="block overflow-hidden rounded-2xl border border-[#EFEFEF] bg-white shadow-card"
            >
              <div className="flex h-40 items-center justify-center p-4 sm:h-48">
                <Image
                  src={p.image}
                  alt={p.name}
                  width={200}
                  height={200}
                  sizes="200px"
                  draggable={false}
                  className="max-h-full w-auto object-contain"
                />
              </div>
              <div className="border-t border-[#EFEFEF] p-3">
                <p className="line-clamp-2 text-sm font-semibold text-[#0A0A0A]">{p.name}</p>
                <p className="mt-1 text-base font-bold text-[#0A0A0A]">{formatPrice(p.price)}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
