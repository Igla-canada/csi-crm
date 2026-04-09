import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { startRingCentralSpeechToTextForCallLog } from "@/lib/ringcentral/transcribe";
import { getUserCapabilities } from "@/lib/user-privileges";

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
    const r = await startRingCentralSpeechToTextForCallLog(callLogId);
    if (!r.ok) {
      return NextResponse.json({ ok: false, message: r.message ?? "Failed." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, jobId: r.jobId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcribe failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
