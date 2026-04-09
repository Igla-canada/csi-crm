import { type NextRequest, NextResponse } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { listCalendarEventsWithRefreshToken } from "@/lib/google-calendar/events";
import { resolveUserGoogleCalendarId } from "@/lib/google-calendar/sync-config";

/**
 * GET ?from=ISO&to=ISO&excludeIds=id1,id2
 * Returns Google Calendar events for the signed-in user’s connected calendar (same account as Settings → Connect Google).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const refresh = user.googleRefreshToken?.trim();
  if (!refresh) {
    return NextResponse.json([]);
  }

  const sp = req.nextUrl.searchParams;
  const fromS = sp.get("from");
  const toS = sp.get("to");
  if (!fromS || !toS) {
    return NextResponse.json({ error: "Query params `from` and `to` (ISO datetimes) are required." }, { status: 400 });
  }
  const timeMin = new Date(fromS);
  const timeMax = new Date(toS);
  if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime())) {
    return NextResponse.json({ error: "Invalid `from` or `to` date." }, { status: 400 });
  }

  const calendarId = resolveUserGoogleCalendarId(user.googleCalendarId);

  try {
    let events = await listCalendarEventsWithRefreshToken(refresh, calendarId, timeMin, timeMax);
    const excludeRaw = sp.get("excludeIds");
    if (excludeRaw) {
      const exclude = new Set(
        excludeRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      events = events.filter((e) => !exclude.has(e.id));
    }
    return NextResponse.json(events);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load Google Calendar.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
