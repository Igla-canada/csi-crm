import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { buildGoogleConsentUrl } from "@/lib/google-calendar/oauth";

/**
 * Starts Google OAuth (offline refresh token). Visit in browser while developing.
 * Console: enable Calendar API + OAuth client (Web) with redirect = GOOGLE_REDIRECT_URI.
 */
export async function GET() {
  const state = randomBytes(32).toString("hex");
  const consentUrl = buildGoogleConsentUrl(state);
  if (!consentUrl) {
    return NextResponse.json(
      {
        error:
          "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI (or APP_URL) in .env.",
      },
      { status: 503 },
    );
  }
  const jar = await cookies();
  const user = await getCurrentUser();
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  jar.set("google_oauth_state", state, cookieOpts);
  jar.set("google_oauth_purpose", "calendar", cookieOpts);
  jar.set("google_oauth_user_email", user.email, cookieOpts);
  return NextResponse.redirect(consentUrl);
}
