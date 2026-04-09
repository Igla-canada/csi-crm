import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildGoogleSignInUrl } from "@/lib/google-calendar/oauth";

const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 600,
  path: "/",
};

/**
 * Starts Google OAuth for CRM sign-in (openid + email + profile).
 * First successful sign-in with an empty User table creates the workspace owner (ADMIN).
 */
export async function GET() {
  const state = randomBytes(32).toString("hex");
  const consentUrl = buildGoogleSignInUrl(state);
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
  jar.set("google_oauth_state", state, cookieBase);
  jar.set("google_oauth_purpose", "signin", cookieBase);
  jar.delete("google_oauth_user_email");
  return NextResponse.redirect(consentUrl);
}
