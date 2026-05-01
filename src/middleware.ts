import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CRM_USER_COOKIE } from "@/lib/crm-user-constants";

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/api/logout" ||
    pathname.startsWith("/api/google/") ||
    // RingCentral (and similar) call these with no browser session; must not redirect to /login.
    pathname.startsWith("/api/ringcentral/telephony-webhook") ||
    pathname.startsWith("/api/ringcentral/ai-webhook") ||
    pathname.startsWith("/api/ringcentral/sync-cron") ||
    pathname.startsWith("/api/ringcentral/telephony-subscribe-cron") ||
    pathname.startsWith("/api/ringcentral/recording-enrichment-cron") ||
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

  if (!req.cookies.get(CRM_USER_COOKIE)?.value?.trim()) {
    // Let Route Handlers enforce session via `cookies()` (same runtime as RSC auth). Edge middleware can disagree with
    // the Node handler on cookie visibility in some deployments, which caused false 401s on `/api/ringcentral/active-calls`
    // while the rest of the app still showed a signed-in shell (e.g. long calls / hold / another line).
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
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
