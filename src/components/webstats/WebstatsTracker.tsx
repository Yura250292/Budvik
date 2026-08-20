"use client";

/**
 * Єдиний глобальний трекер вітрини. Нічого не рендерить.
 *
 * Живе в Providers, тобто монтується один раз на весь застосунок. Це
 * клієнтський компонент усередині серверного layout — ISR сторінок він не
 * зачіпає.
 *
 * Свідомо НЕ використовує useSearchParams: у корені дерева цей хук
 * переводить усі сторінки в клієнтський рендер і вбиває статику. Пошук
 * зі своїм запитом трекає окремий острівець на сторінці каталогу.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { startWebstats, track, flush, isNewSession } from "@/lib/webstats/client";

/** Види контактів, кліки по яких рахуємо як звернення. */
const CONTACT_PATTERNS: Array<{ prefix: string; label: string }> = [
  { prefix: "tel:", label: "tel" },
  { prefix: "mailto:", label: "mailto" },
  { prefix: "viber:", label: "viber" },
];

function contactLabel(href: string): string | null {
  const lower = href.toLowerCase();
  for (const { prefix, label } of CONTACT_PATTERNS) {
    if (lower.startsWith(prefix)) return label;
  }
  if (lower.includes("t.me/")) return "telegram";
  return null;
}

export default function WebstatsTracker() {
  const pathname = usePathname();

  // Разова підписка на закриття вкладки, кліки по контактах і дії з
  // кошиком. Усе в одному ефекті з порожніми залежностями — щоб
  // навігація не перевішувала слухачі щоразу.
  useEffect(() => {
    startWebstats();

    /**
     * Кліки по телефону й пошті ловимо делегуванням на document: ці
     * посилання живуть у серверному футері, і робити його клієнтським
     * заради аналітики було б дорого.
     */
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.("a");
      const href = link?.getAttribute("href");
      if (!href) return;
      const label = contactLabel(href);
      if (label) {
        track("phone_click", { label, path: window.location.pathname });
        // Телефон одразу відкриває дзвонилку й ховає вкладку — шлемо
        // не чекаючи чергового флашу.
        flush();
      }
    };
    document.addEventListener("click", onClick, { capture: true, passive: true });

    /**
     * Кошик, обране й порівняння вже шлють свої події по window —
     * підписуємось на них замість того, щоб правити сім місць виклику.
     * Рахуємо лише додавання: detail.action === "add". Старі диспатчі
     * без detail (зміна кількості, очищення) сюди не потраплять.
     */
    const cartEvents: Array<[string, "add_to_cart" | "add_to_wishlist" | "add_to_compare"]> = [
      ["cart-updated", "add_to_cart"],
      ["wishlist-updated", "add_to_wishlist"],
      ["compare-updated", "add_to_compare"],
    ];

    const handlers = cartEvents.map(([domEvent, type]) => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail as
          | { action?: string; productId?: string; qty?: number }
          | undefined;
        if (detail?.action !== "add") return;
        track(type, {
          productId: detail.productId ?? null,
          value: detail.qty ?? null,
          path: window.location.pathname,
        });
      };
      window.addEventListener(domEvent, handler);
      return { domEvent, handler };
    });

    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      for (const { domEvent, handler } of handlers) {
        window.removeEventListener(domEvent, handler);
      }
    };
  }, []);

  // Перегляд сторінки. Реферер пишемо лише на першій сторінці візиту:
  // далі ним був би наш власний сайт.
  useEffect(() => {
    if (!pathname) return;
    const fresh = isNewSession();
    const referrer = fresh && document.referrer ? document.referrer : null;
    track("page_view", {
      path: pathname,
      referrer: referrer && !referrer.includes(window.location.host) ? referrer : null,
    });
  }, [pathname]);

  return null;
}
