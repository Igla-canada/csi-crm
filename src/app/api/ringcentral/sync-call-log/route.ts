import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { syncSingleRingCentralCallLogByCrmId } from "@/lib/ringcentral/sync-call-logs";
import { getUserCapabilities } from "@/lib/user-privileges";
import { VERCEL_NODE_MAX_DURATION_SECONDS } from "@/lib/vercel-node-max-duration";

export const maxDuration = VERCEL_NODE_MAX_DURATION_SECONDS;

/**
 * Re-fetches one call log from RingCentral (by stored RingCentral call id or `webhook-ts:` session placeholder)
 * and updates recording URIs and metadata — same upsert path as workspace sync, scoped to one CRM row.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canConfigure && !caps.canEditCallLogs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isRingCentralConfigured()) {
    return NextResponse.json({ error: "RingCentral is not configured." }, { status: 400 });
  }

  let callLogId = "";
  try {
    const body = await req.json();
    if (body && typeof body === "object" && body !== null && "callLogId" in body) {
      callLogId = String((body as { callLogId: unknown }).callLogId ?? "").trim();
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!callLogId) {
    return NextResponse.json({ error: "callLogId is required." }, { status: 400 });
  }

  try {
    const result = await syncSingleRingCentralCallLogByCrmId(callLogId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/ringcentral/sync-call-log]", callLogId, e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed." },
      { status: 500 },
    );
  }
}
