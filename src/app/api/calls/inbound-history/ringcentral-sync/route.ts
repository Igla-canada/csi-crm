import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { ringCentralSyncWindowForInboundHistoryFilter } from "@/lib/crm";
import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { syncRingCentralVoiceCallLogsFromApi } from "@/lib/ringcentral/sync-call-logs";
import { getUserCapabilities } from "@/lib/user-privileges";

/**
 * Account call-log sync pages RingCentral, may batch-fetch per-id details, and can expand session graphs per row.
 * Without an explicit limit, Vercel’s default serverless cap often ends the request as **504** while work is still running.
 * Set the same ceiling in the Vercel project (Functions) if the dashboard caps this route lower than 300s.
 */
export const maxDuration = 300;

/**
 * Pulls voice call logs from RingCentral for the inbound-history date filter (or last 48h when unfiltered),
 * upserts into the DB, then clients should refetch `/api/calls/inbound-history`.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canViewCallsSection) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isRingCentralConfigured()) {
    return NextResponse.json({ error: "RingCentral is not configured." }, { status: 400 });
  }

  let body: { dateFrom?: string; dateTo?: string } = {};
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    /* ignore */
  }

  const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom.trim() : "";
  const dateTo = typeof body.dateTo === "string" ? body.dateTo.trim() : "";
  const filter =
    dateFrom || dateTo ? { dateFrom: dateFrom || null, dateTo: dateTo || null } : null;

  const window = ringCentralSyncWindowForInboundHistoryFilter(filter);

  try {
    const result = await syncRingCentralVoiceCallLogsFromApi(
      window ? { happenedAtRange: window } : { hoursBack: 168 },
    );
    return NextResponse.json({ ...result, usedRingCentralWindow: Boolean(window) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
