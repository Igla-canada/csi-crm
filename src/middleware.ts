import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/api/logout" ||
    pathname.startsWith("/api/google/") ||
    // RingCentral (and similar) call these with no browser session; must not redirect to /login.
    pathname.startsWith("/api/ringcentral/telephony-webhook") ||
    pathname.startsWith("/api/ringcentral/ai-webhook") ||
    pathname.startsWith("/api/ringcentral/sync-cron") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(ico|png|jpg|jpeg|svg|webp|gif)$/i.test(pathname)
  );
}

export function middleware(req: NextRequest) {
  if (isPublicPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (process.env.CRM_ALLOW_DEFAULT_USER === "true") {
    return NextResponse.next();
  }

  if (!req.cookies.get("crm-user")?.value?.trim()) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
