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

  return (
    <div ref={elRef}>
      {children}
    </div>
  );
}
