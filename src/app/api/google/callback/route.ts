import { google } from "googleapis";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { signInOrBootstrapUserFromGoogle } from "@/lib/crm";
import { getSupabaseAdmin, tables } from "@/lib/db";
import { createOAuth2Client, exchangeCodeForTokens } from "@/lib/google-calendar/oauth";
import { CRM_USER_COOKIE, getCrmSessionCookieOptions } from "@/lib/session-cookie";

/**
 * Google OAuth callback. Handles:
 * - **signin** — read profile, bootstrap first ADMIN or match Team email, set `crm-user` cookie.
 * - **calendar** — store refresh token on the signed-in CRM user (existing behavior).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const oauthError = sp.get("error");
  if (oauthError) {
    return new NextResponse(`Google OAuth error: ${oauthError}`, {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const jar = await cookies();
  const expected = jar.get("google_oauth_state")?.value;
  const purpose = jar.get("google_oauth_purpose")?.value ?? "calendar";
  const oauthUserEmail = jar.get("google_oauth_user_email")?.value ?? null;

  jar.delete("google_oauth_state");
  jar.delete("google_oauth_purpose");
  jar.delete("google_oauth_user_email");

  if (!state || !expected || state !== expected) {
    return new NextResponse("Invalid or missing OAuth state. Start again from the sign-in or Settings page.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (!code) {
    return new NextResponse("Missing authorization code.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    if (purpose === "signin") {
      const client = createOAuth2Client();
      if (!client) {
        throw new Error("OAuth client not configured.");
      }
      client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      const { data: profile } = await oauth2.userinfo.get();
      const email = profile?.email?.trim().toLowerCase();
      const displayName = profile?.name?.trim() || profile?.given_name || email || "";
      if (!email) {
        const url = new URL("/login", req.nextUrl.origin);
        url.searchParams.set("error", "no_email");
        return NextResponse.redirect(url);
      }

      try {
        await signInOrBootstrapUserFromGoogle({ email, displayName });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Sign-in failed.";
        const url = new URL("/login", req.nextUrl.origin);
        if (msg.startsWith("NOT_INVITED")) {
          url.searchParams.set("error", "not_invited");
        } else {
          url.searchParams.set("error", "signin");
          url.searchParams.set("message", msg.slice(0, 200));
        }
        return NextResponse.redirect(url);
      }

      // Set session on the same `cookies()` store as the OAuth state deletes above. Putting `crm-user` only on a
      // separate `NextResponse.cookies` can fail to persist in the App Router (refresh / dock poll then see no cookie).
      jar.set(CRM_USER_COOKIE, email, getCrmSessionCookieOptions());
      return NextResponse.redirect(new URL("/", req.nextUrl.origin));
    }

    const refresh = tokens.refresh_token;
    if (!refresh) {
      return new NextResponse(
        [
          "Google did not return a refresh token.",
          "Revoke this app at https://myaccount.google.com/permissions then try again.",
          "(First-time consent with prompt=consent is required for a refresh token.)",
        ].join("\n"),
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    if (oauthUserEmail?.includes("@")) {
      const supabase = getSupabaseAdmin();
      const { error: upErr } = await supabase
        .from(tables.User)
        .update({
          googleRefreshToken: refresh,
          updatedAt: new Date().toISOString(),
        })
        .eq("email", oauthUserEmail);
      if (upErr) {
        const url = new URL("/settings", req.nextUrl.origin);
        url.searchParams.set("google", "error");
        url.searchParams.set("message", upErr.message);
        return NextResponse.redirect(url);
      }
      return NextResponse.redirect(new URL("/settings?google=connected", req.nextUrl.origin));
    }
    return new NextResponse(
      [
        "Add this line to your .env file, then restart the dev server:",
        "",
        `GOOGLE_REFRESH_TOKEN=${refresh}`,
        "",
        "Ensure GOOGLE_CALENDAR_ID is set to the calendar you want events in.",
        "",
        "Tip: sign in to the CRM, then connect Google from Settings to attach the token to your user.",
      ].join("\n"),
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token exchange failed.";
    return new NextResponse(msg, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
