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
  const elRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);

  const touchRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    locked: boolean | null;
    hasValidTarget: boolean;
  } | null>(null);

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

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const isMobile = () => window.innerWidth < 768;

    const onTouchStart = (e: TouchEvent) => {
      if (!isMobile() || animatingRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest(".drawer-panel, .drawer-overlay, .no-swipe, input, textarea, [contenteditable], .swiper, .carousel")) return;

      const touch = e.touches[0];
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        locked: null,
        hasValidTarget: false,
      };

      // Check if there's a valid next page in either direction
      const idx = getIndex(pathname);
      const routes = getRoutes();
      touchRef.current.hasValidTarget = idx >= 0 && (idx > 0 || idx < routes.length - 1);
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = touchRef.current;
      if (!t || !isMobile()) return;
      const touch = e.touches[0];
      const dx = touch.clientX - t.startX;
      const dy = Math.abs(touch.clientY - t.startY);

      if (t.locked === null && (Math.abs(dx) > 10 || dy > 10)) {
        t.locked = Math.abs(dx) > dy;
      }
      if (!t.locked) {
        touchRef.current = null;
        return;
      }

      if (!t.hasValidTarget) return;

      // Check direction validity
      const idx = getIndex(pathname);
      const routes = getRoutes();
      const dir = dx > 0 ? -1 : 1;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= routes.length || routes[nextIdx] === routes[idx]) {
        // Rubber-band: allow small overscroll
        const rubber = dx * 0.15;
        el.style.transform = `translate3d(${rubber}px, 0, 0)`;
        el.style.transition = "none";
        return;
      }

      // Direct DOM — no React re-render
      const maxDrag = window.innerWidth * 0.35;
      const clamped = Math.max(-maxDrag, Math.min(maxDrag, dx));
      el.style.transform = `translate3d(${clamped}px, 0, 0)`;
      el.style.transition = "none";
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t = touchRef.current;
      if (!t || !isMobile()) return;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - t.startX;
      const dy = Math.abs(touch.clientY - t.startY);
      const dt = Date.now() - t.startTime;
      const wasLocked = t.locked;
      touchRef.current = null;

      const absDx = Math.abs(dx);

      // Not a valid swipe — snap back
      if (!wasLocked || absDx < 60 || dy > absDx * 0.7 || dt > 500) {
        el.style.transition = "transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "";
        return;
      }

      const routes = getRoutes();
      const idx = getIndex(pathname);
      if (idx < 0) {
        el.style.transition = "transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "";
        return;
      }

      const dir = dx > 0 ? -1 : 1;
      const nextIdx = idx + dir;

      if (nextIdx < 0 || nextIdx >= routes.length || routes[nextIdx] === routes[idx]) {
        el.style.transition = "transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "";
        return;
      }

      // Slide out
      animatingRef.current = true;
      const slideOut = dir > 0 ? -window.innerWidth * 0.6 : window.innerWidth * 0.6;
      el.style.transition = "transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease";
      el.style.transform = `translate3d(${slideOut}px, 0, 0)`;
      el.style.opacity = "0.4";

      setTimeout(() => {
        router.push(routes[nextIdx]);
        // Prepare slide-in position
        const slideIn = dir > 0 ? window.innerWidth * 0.25 : -window.innerWidth * 0.25;
        el.style.transition = "none";
        el.style.transform = `translate3d(${slideIn}px, 0, 0)`;
        el.style.opacity = "0.4";

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease";
            el.style.transform = "";
            el.style.opacity = "";
            setTimeout(() => {
              animatingRef.current = false;
            }, 300);
          });
        });
      }, 200);
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

  return (
    <div ref={elRef} style={{ willChange: "transform, opacity" }}>
      {children}
    </div>
  );
}
