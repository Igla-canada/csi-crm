import "server-only";
import { google } from "googleapis";

import { getGoogleRefreshToken } from "./env";
import { createOAuth2Client } from "./oauth";

export function getCalendarV3() {
  const refresh = getGoogleRefreshToken();
  return getCalendarV3WithRefreshToken(refresh ?? "");
}

/** Uses the given refresh token (e.g. per-user token from the database). */
export function getCalendarV3WithRefreshToken(refreshToken: string) {
  const trimmed = refreshToken.trim();
  const oauth2 = createOAuth2Client();
  if (!trimmed || !oauth2) return null;
  oauth2.setCredentials({ refresh_token: trimmed });
  return google.calendar({ version: "v3", auth: oauth2 });
}
