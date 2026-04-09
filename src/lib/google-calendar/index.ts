/**
 * Google Calendar integration (server-only).
 *
 * - Per user: Settings → Connect Google Calendar (or `/api/google/oauth` while signed in) stores refresh token on the User row.
 * - Shop-wide fallback: `GOOGLE_REFRESH_TOKEN` + `GOOGLE_CALENDAR_ID` in `.env` when the creator has not connected.
 * - Legacy: visiting `/api/google/oauth` without the user cookie still returns a token to paste into `.env`.
 */
export {
  deleteCalendarEvent,
  deleteCalendarEventWithRefreshToken,
  getCalendarEventWithRefreshToken,
  insertCalendarEvent,
  insertCalendarEventWithRefreshToken,
  listCalendarEventsWithRefreshToken,
  patchCalendarEvent,
  patchCalendarEventWithRefreshToken,
  type GoogleCalendarEventPatchInput,
  type GoogleCalendarEventWriteInput,
  type ListedGoogleEvent,
} from "./events";
export { getAppTimezone, getGoogleOAuthEnv, getGoogleRefreshToken } from "./env";
export { buildGoogleConsentUrl, createOAuth2Client, exchangeCodeForTokens, GOOGLE_CALENDAR_EVENTS_SCOPE } from "./oauth";
export {
  googleCalendarSyncConfig,
  resolveAppointmentGoogleSync,
  resolveGoogleTargetCalendarId,
  type AppointmentGoogleSyncPlan,
} from "./sync-config";
