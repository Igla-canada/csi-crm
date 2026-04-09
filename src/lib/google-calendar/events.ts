import "server-only";

import type { calendar_v3 } from "googleapis";
import { TZDate } from "@date-fns/tz";
import { addDays, format, parseISO, startOfDay } from "date-fns";

import { getAppTimezone } from "./env";
import { getCalendarV3, getCalendarV3WithRefreshToken } from "./client";

export type ListedGoogleEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink?: string;
};

export type GoogleCalendarEventWriteInput = {
  summary: string;
  description?: string | null;
  start: Date;
  end: Date;
  allDay?: boolean;
  location?: string | null;
  attendeeEmails?: string[];
  /** Maps to Google Calendar transparency: busy = opaque, free = transparent */
  showAs?: "busy" | "free";
  visibility?: "default" | "public" | "private" | "confidential";
  /** e.g. ["RRULE:FREQ=WEEKLY"] — omit or empty for one-off events */
  recurrence?: string[] | null;
};

function parseGoogleEventBounds(e: calendar_v3.Schema$Event): { start: Date; end: Date; allDay: boolean } | null {
  if (e.start?.dateTime && e.end?.dateTime) {
    return {
      start: new Date(e.start.dateTime),
      end: new Date(e.end.dateTime),
      allDay: false,
    };
  }
  if (e.start?.date && e.end?.date) {
    const start = parseISO(`${e.start.date}T00:00:00`);
    const endExclusive = parseISO(`${e.end.date}T00:00:00`);
    const end = new Date(endExclusive.getTime() - 1);
    return { start, end, allDay: true };
  }
  return null;
}

/** Lists events in a range for the user’s connected calendar (timed + all-day). */
export async function listCalendarEventsWithRefreshToken(
  refreshToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<ListedGoogleEvent[]> {
  const calendar = getCalendarV3WithRefreshToken(refreshToken);
  if (!calendar) return [];
  const res = await calendar.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });
  const items = res.data.items ?? [];
  const out: ListedGoogleEvent[] = [];
  for (const e of items) {
    if (!e.id) continue;
    const bounds = parseGoogleEventBounds(e);
    if (!bounds) continue;
    out.push({
      id: e.id,
      summary: (e.summary?.trim() || "(No title)").slice(0, 200),
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString(),
      allDay: bounds.allDay,
      htmlLink: e.htmlLink ?? undefined,
    });
  }
  return out;
}

function buildAttendees(emails: string[] | undefined): calendar_v3.Schema$EventAttendee[] | undefined {
  if (!emails?.length) return undefined;
  const seen = new Set<string>();
  const list: calendar_v3.Schema$EventAttendee[] = [];
  for (const raw of emails) {
    const e = raw.trim().toLowerCase();
    if (!e || !e.includes("@") || seen.has(e)) continue;
    seen.add(e);
    list.push({ email: raw.trim() });
  }
  return list.length ? list : undefined;
}

function allDayDateRange(start: Date, end: Date): { startDate: string; endDateExclusive: string } {
  const s = format(startOfDay(start), "yyyy-MM-dd");
  const endDay = startOfDay(end);
  const exclusive = format(addDays(endDay, 1), "yyyy-MM-dd");
  return { startDate: s, endDateExclusive: exclusive };
}

/**
 * Google expects `dateTime` as wall time in `timeZone` (RFC3339 without a conflicting offset).
 * Sending UTC `...Z` plus `timeZone` often shifts events on the calendar vs CRM.
 */
function googleTimedDateTimeFields(instant: Date): { dateTime: string; timeZone: string } {
  const timeZone = getAppTimezone();
  const zd = new TZDate(instant.getTime(), timeZone);
  return {
    dateTime: format(zd, "yyyy-MM-dd'T'HH:mm:ss"),
    timeZone,
  };
}

function buildEventRequestBody(input: GoogleCalendarEventWriteInput): calendar_v3.Schema$Event {
  const visibility =
    input.visibility && input.visibility !== "default" ? input.visibility : undefined;
  const transparency = input.showAs === "free" ? "transparent" : "opaque";
  const attendees = buildAttendees(input.attendeeEmails);
  const recurrence =
    input.recurrence && input.recurrence.length > 0 ? input.recurrence : undefined;

  const base: calendar_v3.Schema$Event = {
    summary: input.summary,
    description: input.description?.trim() ? input.description.trim() : undefined,
    location: input.location?.trim() ? input.location.trim() : undefined,
    transparency,
    visibility,
    attendees,
    recurrence,
  };

  if (input.allDay) {
    const { startDate, endDateExclusive } = allDayDateRange(input.start, input.end);
    return {
      ...base,
      start: { date: startDate },
      end: { date: endDateExclusive },
    };
  }

  const gs = googleTimedDateTimeFields(input.start);
  const ge = googleTimedDateTimeFields(input.end);
  return {
    ...base,
    start: { dateTime: gs.dateTime, timeZone: gs.timeZone },
    end: { dateTime: ge.dateTime, timeZone: ge.timeZone },
  };
}

async function insertEventForCalendar(
  calendar: NonNullable<ReturnType<typeof getCalendarV3>>,
  calendarId: string,
  input: GoogleCalendarEventWriteInput,
): Promise<string> {
  const res = await calendar.events.insert({
    calendarId,
    requestBody: buildEventRequestBody(input),
  });
  const id = res.data.id;
  if (!id) {
    throw new Error("Google Calendar did not return an event id.");
  }
  return id;
}

export async function insertCalendarEvent(input: GoogleCalendarEventWriteInput & { calendarId: string }): Promise<string> {
  const calendar = getCalendarV3();
  if (!calendar) {
    throw new Error("Google Calendar API client is not configured (refresh token missing).");
  }
  return insertEventForCalendar(calendar, input.calendarId, input);
}

export async function insertCalendarEventWithRefreshToken(
  refreshToken: string,
  input: GoogleCalendarEventWriteInput & { calendarId: string },
): Promise<string> {
  const calendar = getCalendarV3WithRefreshToken(refreshToken);
  if (!calendar) {
    throw new Error("Google OAuth client is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  }
  return insertEventForCalendar(calendar, input.calendarId, input);
}

export async function deleteCalendarEvent(calendarId: string, eventId: string): Promise<void> {
  const calendar = getCalendarV3();
  if (!calendar) {
    throw new Error("Google Calendar API client is not configured.");
  }
  await calendar.events.delete({ calendarId, eventId });
}

export async function deleteCalendarEventWithRefreshToken(
  refreshToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const calendar = getCalendarV3WithRefreshToken(refreshToken);
  if (!calendar) {
    throw new Error("Google OAuth client is not configured.");
  }
  await calendar.events.delete({ calendarId, eventId });
}

export type GoogleCalendarEventPatchInput = {
  summary?: string;
  description?: string | null;
  start?: Date;
  end?: Date;
  allDay?: boolean;
  location?: string | null;
  attendeeEmails?: string[];
  showAs?: "busy" | "free";
  visibility?: "default" | "public" | "private" | "confidential";
  /** When set, Google Calendar recurrence is updated (same shape as insert). */
  recurrence?: string[];
};

function buildPatchBody(body: GoogleCalendarEventPatchInput): calendar_v3.Schema$Event {
  const out: calendar_v3.Schema$Event = {};

  if (body.summary != null) out.summary = body.summary;
  if (body.description !== undefined) {
    out.description = body.description?.trim() ? body.description.trim() : undefined;
  }
  if (body.location !== undefined) {
    out.location = body.location?.trim() ? body.location.trim() : undefined;
  }
  if (body.showAs === "free") out.transparency = "transparent";
  else if (body.showAs === "busy") out.transparency = "opaque";

  if (body.visibility !== undefined) {
    out.visibility = body.visibility === "default" ? undefined : body.visibility;
  }

  const attendees = buildAttendees(body.attendeeEmails);
  if (attendees) out.attendees = attendees;

  if (body.start && body.end) {
    if (body.allDay) {
      const { startDate, endDateExclusive } = allDayDateRange(body.start, body.end);
      out.start = { date: startDate };
      out.end = { date: endDateExclusive };
    } else {
      const gs = googleTimedDateTimeFields(body.start);
      const ge = googleTimedDateTimeFields(body.end);
      out.start = { dateTime: gs.dateTime, timeZone: gs.timeZone };
      out.end = { dateTime: ge.dateTime, timeZone: ge.timeZone };
    }
  }

  if (body.recurrence?.length) {
    out.recurrence = body.recurrence;
  }

  return out;
}

export async function patchCalendarEvent(
  calendarId: string,
  eventId: string,
  body: GoogleCalendarEventPatchInput,
): Promise<void> {
  const calendar = getCalendarV3();
  if (!calendar) {
    throw new Error("Google Calendar API client is not configured.");
  }
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: buildPatchBody(body),
  });
}

export async function patchCalendarEventWithRefreshToken(
  refreshToken: string,
  calendarId: string,
  eventId: string,
  body: GoogleCalendarEventPatchInput,
): Promise<void> {
  const calendar = getCalendarV3WithRefreshToken(refreshToken);
  if (!calendar) {
    throw new Error("Google OAuth client is not configured.");
  }
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: buildPatchBody(body),
  });
}

/** Load a single event (for merging Google edits into the full editor). */
export async function getCalendarEventWithRefreshToken(
  refreshToken: string,
  calendarId: string,
  eventId: string,
): Promise<calendar_v3.Schema$Event | null> {
  const calendar = getCalendarV3WithRefreshToken(refreshToken);
  if (!calendar) return null;
  try {
    const res = await calendar.events.get({ calendarId, eventId });
    return res.data ?? null;
  } catch {
    return null;
  }
}
