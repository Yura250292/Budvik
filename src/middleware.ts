import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Admin routes - only ADMIN, MANAGER and SALES
    if (pathname.startsWith("/admin")) {
      if (token?.role !== "ADMIN" && token?.role !== "MANAGER" && token?.role !== "SALES") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
      // /admin/users тепер не просто список клієнтів, а місце, де роздають
      // ролі й паролі — блокування для SALES тут критичніше, ніж було.
      // Увага: /admin/reports і /admin/sales-reports обов'язково тут —
      // SALES пускається в /admin, і без цього торговий бачив би
      // статистику всіх колег.
      // Виняток — /admin/sales-analytics: API сам скоупить SALES до
      // власних даних (scope: "own"), тож широкий префікс "/admin/sales"
      // тут замінено на явний перелік, інакше торговий не бачив би
      // навіть свою аналітику.
      if (
        (pathname.startsWith("/admin/products") ||
         pathname.startsWith("/admin/users") ||
         pathname === "/admin/sales" ||
         pathname.startsWith("/admin/sales/") ||
         pathname.startsWith("/admin/sales-reports") ||
         pathname.startsWith("/admin/sales-reps") ||
         // Архів АІ-звітів — виняток із винятку: сама /admin/sales-analytics
         // відкрита торговому, але збережені звіти лежать упереміш по всій
         // команді, і скоупити їх нічим.
         pathname.startsWith("/admin/sales-analytics/saved") ||
         pathname.startsWith("/admin/reports") ||
         pathname.startsWith("/admin/erp/reports") ||
         pathname.startsWith("/admin/erp/stats") ||
         pathname.startsWith("/admin/warehouse-reports") ||
         pathname.startsWith("/admin/integration")) &&
        token?.role !== "ADMIN" && token?.role !== "MANAGER"
      ) {
        return NextResponse.redirect(new URL("/admin", req.url));
      }
    }

    // Manager portal
    if (pathname.startsWith("/manager")) {
      if (token?.role !== "ADMIN" && token?.role !== "MANAGER") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    // Warehouse routes
    if (pathname.startsWith("/warehouse")) {
      if (token?.role !== "ADMIN" && token?.role !== "MANAGER" && token?.role !== "WAREHOUSE") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    // Driver routes
    if (pathname.startsWith("/driver")) {
      if (token?.role !== "ADMIN" && token?.role !== "MANAGER" && token?.role !== "DRIVER") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;
        if (
          pathname.startsWith("/dashboard") ||
          pathname.startsWith("/admin") ||
          pathname.startsWith("/warehouse") ||
          pathname.startsWith("/driver") ||
          pathname.startsWith("/sales") ||
          pathname.startsWith("/manager")
        ) {
          return !!token;
        }
        return true;
      },
    },
  }
);

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/warehouse/:path*", "/driver/:path*", "/sales/:path*", "/manager/:path*"],
};
