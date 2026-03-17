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
      if (
        (pathname.startsWith("/admin/products") ||
         pathname.startsWith("/admin/users") ||
         pathname.startsWith("/admin/sales") ||
         pathname.startsWith("/admin/integration")) &&
        token?.role !== "ADMIN" && token?.role !== "MANAGER"
      ) {
        return NextResponse.redirect(new URL("/admin", req.url));
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
          pathname.startsWith("/sales")
        ) {
          return !!token;
        }
        return true;
      },
    },
  }
);

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/warehouse/:path*", "/driver/:path*", "/sales/:path*"],
};
