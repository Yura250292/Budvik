"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const elRef = useRef<HTMLDivElement>(null);
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    const el = elRef.current;
    if (!el || prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;

    // В адмінці шелл (сайдбар, шапка, смужка вкладок) статичний, а вміст
    // вкладок лишається змонтованим — анімація всього піддерева блимала б
    // інтерфейсом на кожному переході.
    if (pathname?.startsWith("/admin")) return;

    // Only animate on mobile
    if (window.innerWidth >= 768) return;

    el.style.opacity = "0";
    el.style.transform = "translate3d(0, 8px, 0)";

    requestAnimationFrame(() => {
      el.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      el.style.opacity = "1";
      el.style.transform = "translate3d(0, 0, 0)";

      const cleanup = () => {
        el.style.transition = "";
        el.style.opacity = "";
        el.style.transform = "";
      };
      el.addEventListener("transitionend", cleanup, { once: true });
      // Fallback cleanup
      setTimeout(cleanup, 250);
    });
  }, [pathname]);

  // flex-колонка з min-h-0: цей div стоїть між body (flex-колонка) і
  // кореневим <main>. Без нього flex-1 на main упирався б у div звичайної
  // висоти, і повноекранні шелли (адмінка, торговий, водій) не отримували б
  // рівно 100dvh — з'являвся б другий, зовнішній скрол.
  return (
    <div ref={elRef} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}
