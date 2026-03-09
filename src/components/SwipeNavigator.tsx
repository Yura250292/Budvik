"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const BASE_ROUTES = ["/", "/catalog", "/cart", "/dashboard/orders", "/dashboard"];
const ADMIN_ROUTES = ["/", "/catalog", "/cart", "/admin", "/dashboard"];
const UNAUTH_ROUTES = ["/", "/catalog", "/cart", "/login", "/login"];

export default function SwipeNavigator({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const navigatingRef = useRef(false);
  const prevPathRef = useRef(pathname);

  const getRoutes = useCallback(() => {
    if (!session) return UNAUTH_ROUTES;
    if (role === "ADMIN" || role === "SALES") return ADMIN_ROUTES;
    return BASE_ROUTES;
  }, [session, role]);

  const getIndex = useCallback((path: string) => {
    const routes = getRoutes();
    let bestIdx = -1;
    let bestLen = 0;
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (r === "/" && path === "/") return i;
      if (r !== "/" && path.startsWith(r) && r.length > bestLen) {
        bestIdx = i;
        bestLen = r.length;
      }
    }
    return bestIdx;
  }, [getRoutes]);

  // Reset navigation lock on route change
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      navigatingRef.current = false;
      prevPathRef.current = pathname;
    }
  }, [pathname]);

  useEffect(() => {
    const isMobile = () => window.innerWidth < 768;
    let startX = 0;
    let startY = 0;
    let locked: boolean | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (!isMobile() || navigatingRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest(".drawer-panel, .drawer-overlay, .no-swipe, input, textarea, [contenteditable], .swiper, .carousel")) return;

      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      locked = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (locked !== null && !locked) return;
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (locked === null && (dx > 10 || dy > 10)) {
        locked = dx > dy;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!locked || !isMobile() || navigatingRef.current) return;

      const dx = e.changedTouches[0].clientX - startX;
      const absDx = Math.abs(dx);

      // Need at least 70px horizontal swipe
      if (absDx < 70) return;

      const routes = getRoutes();
      const idx = getIndex(pathname);
      if (idx < 0) return;

      const dir = dx > 0 ? -1 : 1; // swipe right = prev tab, swipe left = next tab
      const nextIdx = idx + dir;

      if (nextIdx >= 0 && nextIdx < routes.length && routes[nextIdx] !== routes[idx]) {
        navigatingRef.current = true;
        router.push(routes[nextIdx]);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [getRoutes, getIndex, router, pathname]);

  return <>{children}</>;
}
