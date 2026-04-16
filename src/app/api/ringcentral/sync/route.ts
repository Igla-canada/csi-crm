import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { syncRingCentralVoiceCallLogsFromApi } from "@/lib/ringcentral/sync-call-logs";
import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { getUserCapabilities } from "@/lib/user-privileges";
import { VERCEL_NODE_MAX_DURATION_SECONDS } from "@/lib/vercel-node-max-duration";

export const maxDuration = VERCEL_NODE_MAX_DURATION_SECONDS;

export async function POST(req: NextRequest) {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canConfigure) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isRingCentralConfigured()) {
    return NextResponse.json({ error: "RingCentral is not configured." }, { status: 400 });
  }

  let hoursBack = 48;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body === "object" && body !== null && "hoursBack" in body) {
      const n = Number((body as { hoursBack: unknown }).hoursBack);
      if (Number.isFinite(n)) hoursBack = n;
    }
  } catch {
    /* ignore */
  }

  try {
    const result = await syncRingCentralVoiceCallLogsFromApi({ hoursBack });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
