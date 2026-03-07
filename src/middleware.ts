import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Admin routes - only ADMIN and SALES
    if (pathname.startsWith("/admin")) {
      if (token?.role !== "ADMIN" && token?.role !== "SALES") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
      // Products, Users, Sales management - only ADMIN
      if (
        (pathname.startsWith("/admin/products") ||
         pathname.startsWith("/admin/users") ||
         pathname.startsWith("/admin/sales") ||
         pathname.startsWith("/admin/integration")) &&
        token?.role !== "ADMIN"
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
