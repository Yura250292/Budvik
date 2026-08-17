"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

/**
 * Знижки по брендах для оптовика — клієнтська половина кешованого каталогу.
 *
 * Сторінки каталогу тепер рендеряться без сесії (інакше ISR вимикається),
 * тож роздрібну ціну бачать усі одразу з кешу, а оптовик добирає свою
 * знижку цим хуком після гідрації. Для всіх, крім ролі WHOLESALE, хук не
 * робить жодного запиту.
 *
 * Кеш у модулі + дедуплікація inflight: на сторінці каталогу 24 картки,
 * і кожна викликає хук — запит має бути один на вкладку.
 */

let cached: Map<string, number> | null = null;
let inflight: Promise<Map<string, number>> | null = null;

async function fetchDiscounts(): Promise<Map<string, number>> {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetch("/api/wholesale/discounts")
      .then((r) => (r.ok ? r.json() : { discounts: {} }))
      .then((data: { discounts?: Record<string, number> }) => {
        cached = new Map(Object.entries(data.discounts ?? {}));
        return cached;
      })
      .catch(() => new Map<string, number>())
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useWholesaleDiscounts(): Map<string, number> | null {
  const { data: session } = useSession();
  const isWholesale = (session?.user as { role?: string } | undefined)?.role === "WHOLESALE";
  const [discounts, setDiscounts] = useState<Map<string, number> | null>(cached);

  useEffect(() => {
    if (!isWholesale) return;
    let alive = true;
    fetchDiscounts().then((map) => {
      if (alive) setDiscounts(map);
    });
    return () => {
      alive = false;
    };
  }, [isWholesale]);

  return isWholesale ? discounts : null;
}
