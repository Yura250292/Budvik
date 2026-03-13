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
      // Users, Integration - only ADMIN
      if (
        (pathname.startsWith("/admin/users") ||
         pathname.startsWith("/admin/integration")) &&
        token?.role !== "ADMIN"
      ) {
        return NextResponse.redirect(new URL("/admin", req.url));
      }
      // Products, Sales management - ADMIN and MANAGER
      if (
        (pathname.startsWith("/admin/products") ||
         pathname.startsWith("/admin/sales")) &&
        token?.role !== "ADMIN" && token?.role !== "MANAGER"
      ) {
        return NextResponse.redirect(new URL("/admin", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;
        // Protected routes
        if (
          pathname.startsWith("/dashboard") ||
          pathname.startsWith("/admin")
        ) {
          return !!token;
        }
        return true;
      },
    },
  }
);

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
