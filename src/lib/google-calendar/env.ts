import "server-only";

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v === "" ? undefined : v;
}

const PLACEHOLDER_IDS = new Set([
  "your-google-client-id",
  "your-google-client-secret",
  "your-google-refresh-token",
  "your-calendar-id@group.calendar.google.com",
]);

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_IDS.has(value);
}

export type GoogleOAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** Client id + secret + redirect URI (OAuth consent / token exchange). */
export function getGoogleOAuthEnv(): GoogleOAuthEnv | null {
  const clientId = trimEnv("GOOGLE_CLIENT_ID");
  const clientSecret = trimEnv("GOOGLE_CLIENT_SECRET");
  const appUrl = trimEnv("APP_URL");
  const redirectUri =
    trimEnv("GOOGLE_REDIRECT_URI") ||
    (appUrl ? `${appUrl.replace(/\/$/, "")}/api/google/callback` : undefined);
  if (!clientId || !clientSecret || !redirectUri) return null;
  if (isPlaceholder(clientId) || isPlaceholder(clientSecret)) return null;
  return { clientId, clientSecret, redirectUri };
}

export function getGoogleRefreshToken(): string | null {
  const t = trimEnv("GOOGLE_REFRESH_TOKEN");
  if (!t || isPlaceholder(t)) return null;
  return t;
}

/** Preferred target calendar (env overrides DB placeholder IDs). */
export function getGoogleCalendarIdFromEnv(): string | null {
  const c = trimEnv("GOOGLE_CALENDAR_ID");
  if (!c || isPlaceholder(c)) return null;
  return c;
}

/** IANA zone for call-history calendar days and on-screen clocks. Eastern shops often use `America/Toronto` or `America/New_York`. */
export function getAppTimezone(): string {
  return trimEnv("APP_TIMEZONE") || "America/Toronto";
}
