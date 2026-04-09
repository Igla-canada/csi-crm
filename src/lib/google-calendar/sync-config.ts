import "server-only";

import { getGoogleCalendarIdFromEnv, getGoogleOAuthEnv, getGoogleRefreshToken } from "./env";

/** DB-only calendar ids that are not real Google calendars (seed / dev). */
function isObviousNonGoogleCalendarId(id: string): boolean {
  const t = id.trim().toLowerCase();
  if (!t) return true;
  if (t.endsWith(".local")) return true;
  if (t.includes("carsystemscrm.local")) return true;
  return false;
}

/**
 * Resolves which Google calendar to write to: env wins, then DB if it looks real.
 */
export function resolveGoogleTargetCalendarId(dbCalendarId: string | null | undefined): string | null {
  const fromEnv = getGoogleCalendarIdFromEnv();
  if (fromEnv) return fromEnv;
  const fromDb = dbCalendarId?.trim();
  if (!fromDb || isObviousNonGoogleCalendarId(fromDb)) return null;
  return fromDb;
}

export type GoogleCalendarSyncConfig = {
  /** OAuth + refresh token + resolvable calendar id. */
  ready: boolean;
  calendarId: string | null;
};

export function googleCalendarSyncConfig(
  calendarConfigRow: { calendarId?: string | null } | null | undefined,
): GoogleCalendarSyncConfig {
  const oauth = getGoogleOAuthEnv();
  const refresh = getGoogleRefreshToken();
  const calendarId = resolveGoogleTargetCalendarId(calendarConfigRow?.calendarId ?? null);
  const ready = Boolean(oauth && refresh && calendarId);
  return { ready, calendarId };
}

/** Calendar id for listing events with a user’s OAuth refresh token (matches Bookings / API route). */
export function resolveUserGoogleCalendarId(stored: string | null | undefined): string {
  const t = stored?.trim();
  if (!t || isObviousNonGoogleCalendarId(t)) return "primary";
  return t;
}

export type AppointmentGoogleSyncPlan =
  | { mode: "none" }
  | { mode: "env"; calendarId: string }
  | { mode: "user"; refreshToken: string; calendarId: string };

/**
 * Per-appointment sync: if the creator connected Google, use their token + calendar (default primary).
 * Otherwise fall back to global .env refresh token + resolved shop calendar id.
 */
export function resolveAppointmentGoogleSync(
  calendarConfigRow: { calendarId?: string | null } | null | undefined,
  creator: { googleRefreshToken?: string | null; googleCalendarId?: string | null } | null | undefined,
): AppointmentGoogleSyncPlan {
  const userRefresh = creator?.googleRefreshToken?.trim();
  if (userRefresh) {
    return {
      mode: "user",
      refreshToken: userRefresh,
      calendarId: resolveUserGoogleCalendarId(creator?.googleCalendarId ?? null),
    };
  }
  const g = googleCalendarSyncConfig(calendarConfigRow);
  if (g.ready && g.calendarId) {
    return { mode: "env", calendarId: g.calendarId };
  }
  return { mode: "none" };
}
