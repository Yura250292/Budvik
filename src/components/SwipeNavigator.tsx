"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

// Bottom nav routes in order (left to right)
const BASE_ROUTES = ["/", "/catalog", "/cart", "/dashboard/orders", "/dashboard"];
const ADMIN_ROUTES = ["/", "/catalog", "/cart", "/admin", "/dashboard"];
const UNAUTH_ROUTES = ["/", "/catalog", "/cart", "/login", "/login"];

export default function SwipeNavigator({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  const touchRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    moved: boolean;
  } | null>(null);

  const getRoutes = useCallback(() => {
    if (!session) return UNAUTH_ROUTES;
    if (role === "ADMIN" || role === "SALES") return ADMIN_ROUTES;
    return BASE_ROUTES;
  }, [session, role]);

  const getCurrentIndex = useCallback(() => {
    const routes = getRoutes();
    // Find best matching route
    let bestIdx = -1;
    let bestLen = 0;
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (r === "/" && pathname === "/") return i;
      if (r !== "/" && pathname.startsWith(r) && r.length > bestLen) {
        bestIdx = i;
        bestLen = r.length;
      }
    }
    return bestIdx;
  }, [pathname, getRoutes]);

  useEffect(() => {
    // Only enable on mobile
    const isMobile = () => window.innerWidth < 768;

    const onTouchStart = (e: TouchEvent) => {
      if (!isMobile()) return;

      // Don't intercept if touching an interactive element that might scroll horizontally
      const target = e.target as HTMLElement;
      if (target.closest(".drawer-panel, .no-swipe, input, textarea, [contenteditable]")) return;

      const touch = e.touches[0];
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        moved: false,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchRef.current || !isMobile()) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchRef.current.startX);
      const dy = Math.abs(touch.clientY - touchRef.current.startY);

      // If moving more vertically, cancel swipe navigation
      if (dy > dx && dy > 10) {
        touchRef.current = null;
        return;
      }

      if (dx > 10) {
        touchRef.current.moved = true;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchRef.current || !isMobile()) return;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchRef.current.startX;
      const dy = Math.abs(touch.clientY - touchRef.current.startY);
      const dt = Date.now() - touchRef.current.startTime;
      touchRef.current = null;

      // Requirements: horizontal > 80px, more horizontal than vertical, fast enough (<400ms)
      const absDx = Math.abs(dx);
      if (absDx < 80 || dy > absDx * 0.7 || dt > 400) return;

      const routes = getRoutes();
      const currentIdx = getCurrentIndex();
      if (currentIdx < 0) return;

      const direction = dx > 0 ? -1 : 1; // swipe right = go left in tabs, swipe left = go right
      const nextIdx = currentIdx + direction;

      if (nextIdx >= 0 && nextIdx < routes.length && routes[nextIdx] !== routes[currentIdx]) {
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
  }, [getRoutes, getCurrentIndex, router]);

  return <>{children}</>;
}
