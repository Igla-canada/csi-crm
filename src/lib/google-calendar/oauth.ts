import "server-only";
import { google } from "googleapis";

import { getGoogleOAuthEnv } from "./env";

/** Create/update events on calendars the user can access. */
export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** OpenID + profile for CRM sign-in (email + display name). */
export const GOOGLE_SIGNIN_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

export function createOAuth2Client() {
  const env = getGoogleOAuthEnv();
  if (!env) return null;
  return new google.auth.OAuth2(env.clientId, env.clientSecret, env.redirectUri);
}

export function buildGoogleConsentUrl(state: string): string | null {
  const client = createOAuth2Client();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GOOGLE_CALENDAR_EVENTS_SCOPE],
    state,
    include_granted_scopes: true,
  });
}

/** Start Google OAuth for CRM sign-in (no calendar scopes). */
export function buildGoogleSignInUrl(state: string): string | null {
  const client = createOAuth2Client();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: "online",
    prompt: "select_account",
    scope: [...GOOGLE_SIGNIN_SCOPES],
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuth2Client();
  if (!client) {
    throw new Error("Google OAuth is not configured (GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI).");
  }
  const { tokens } = await client.getToken(code);
  return tokens;
}
