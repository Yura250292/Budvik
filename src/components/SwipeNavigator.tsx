"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);
  const prevPathRef = useRef(pathname);

  const touchRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    locked: boolean | null;
  } | null>(null);

  const getRoutes = useCallback(() => {
    if (!session) return UNAUTH_ROUTES;
    if (role === "ADMIN" || role === "SALES") return ADMIN_ROUTES;
    return BASE_ROUTES;
  }, [session, role]);

  const getCurrentIndex = useCallback(() => {
    const routes = getRoutes();
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

  // Detect route change and play slide-in animation
  useEffect(() => {
    if (prevPathRef.current !== pathname && slideDirection) {
      setIsAnimating(true);
      setSwipeOffset(0);
      const timer = setTimeout(() => {
        setIsAnimating(false);
        setSlideDirection(null);
      }, 350);
      prevPathRef.current = pathname;
      return () => clearTimeout(timer);
    }
    prevPathRef.current = pathname;
  }, [pathname, slideDirection]);

  useEffect(() => {
    const isMobile = () => window.innerWidth < 768;

    const onTouchStart = (e: TouchEvent) => {
      if (!isMobile() || isAnimating) return;
      const target = e.target as HTMLElement;
      if (target.closest(".drawer-panel, .drawer-overlay, .no-swipe, input, textarea, [contenteditable], .swiper, .carousel")) return;

      const touch = e.touches[0];
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        locked: null,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchRef.current || !isMobile()) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchRef.current.startX;
      const dy = Math.abs(touch.clientY - touchRef.current.startY);

      // Determine direction lock
      if (touchRef.current.locked === null && (Math.abs(dx) > 10 || dy > 10)) {
        touchRef.current.locked = Math.abs(dx) > dy;
      }

      if (!touchRef.current.locked) {
        touchRef.current = null;
        return;
      }

      // Show real-time drag offset (capped)
      const routes = getRoutes();
      const currentIdx = getCurrentIndex();
      const direction = dx > 0 ? -1 : 1;
      const nextIdx = currentIdx + direction;

      // Only show offset if there's a valid next page
      if (currentIdx >= 0 && nextIdx >= 0 && nextIdx < routes.length && routes[nextIdx] !== routes[currentIdx]) {
        const maxDrag = window.innerWidth * 0.4;
        const clamped = Math.max(-maxDrag, Math.min(maxDrag, dx));
        setSwipeOffset(clamped);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!touchRef.current || !isMobile()) return;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchRef.current.startX;
      const dy = Math.abs(touch.clientY - touchRef.current.startY);
      const dt = Date.now() - touchRef.current.startTime;
      const wasLocked = touchRef.current.locked;
      touchRef.current = null;

      const absDx = Math.abs(dx);

      // If not enough swipe, snap back
      if (!wasLocked || absDx < 70 || dy > absDx * 0.7 || dt > 500) {
        if (swipeOffset !== 0) {
          setSwipeOffset(0);
        }
        return;
      }

      const routes = getRoutes();
      const currentIdx = getCurrentIndex();
      if (currentIdx < 0) {
        setSwipeOffset(0);
        return;
      }

      const direction = dx > 0 ? -1 : 1;
      const nextIdx = currentIdx + direction;

      if (nextIdx >= 0 && nextIdx < routes.length && routes[nextIdx] !== routes[currentIdx]) {
        // Animate slide out
        setSlideDirection(direction > 0 ? "left" : "right");
        setSwipeOffset(direction > 0 ? -window.innerWidth : window.innerWidth);

        setTimeout(() => {
          router.push(routes[nextIdx]);
          // Reset offset to slide-in from opposite side
          setSwipeOffset(direction > 0 ? window.innerWidth * 0.3 : -window.innerWidth * 0.3);
        }, 150);
      } else {
        setSwipeOffset(0);
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
  }, [getRoutes, getCurrentIndex, router, isAnimating, swipeOffset]);

  const style: React.CSSProperties = {};
  if (swipeOffset !== 0 || isAnimating) {
    style.transform = `translateX(${swipeOffset}px)`;
    style.transition = touchRef.current ? "none" : "transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)";
    style.willChange = "transform";
  }
  if (isAnimating) {
    style.opacity = swipeOffset === 0 ? 1 : undefined;
  }

  return (
    <div ref={containerRef} style={style} className="swipe-content">
      {children}
    </div>
  );
}
