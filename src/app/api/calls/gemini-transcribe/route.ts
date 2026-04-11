import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { CallDirection, getSupabaseAdmin, tables } from "@/lib/db";
import {
  clearCallLogGeminiPending,
  lockCallLogForGeminiTranscription,
  persistGeminiCallTranscription,
} from "@/lib/crm";
import { transcribeCallRecordingWithGemini } from "@/lib/gemini/transcribe-call-log";
import { getGeminiApiKey } from "@/lib/gemini/env";
import { getAppTimezone } from "@/lib/google-calendar/env";
import { fetchFirstCallLogRecordingBytes } from "@/lib/ringcentral/fetch-call-log-recording-bytes";
import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { getUserCapabilities } from "@/lib/user-privileges";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canViewClients) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!caps.canConfigure && !caps.canEditCallLogs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!getGeminiApiKey()) {
    return NextResponse.json(
      { error: "Gemini is not configured. Set GEMINI_API_KEY on the server." },
      { status: 503 },
    );
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

  const sb = getSupabaseAdmin();
  const { data: row, error: rowErr } = await sb
    .from(tables.CallLog)
    .select(
      "id,direction,happenedAt,telephonyResult,contactName,contactPhone,telephonyTranscript,telephonyAiSummary,telephonyAiJobId,telephonyGeminiPending",
    )
    .eq("id", callLogId)
    .maybeSingle();
  if (rowErr) throw rowErr;
  if (!row) {
    return NextResponse.json({ error: "Call not found." }, { status: 404 });
  }
  if (String(row.direction) !== CallDirection.INBOUND) {
    return NextResponse.json({ error: "Only inbound calls can be transcribed from call history." }, { status: 400 });
  }

  const transcript = String((row.telephonyTranscript as string | null) ?? "").trim();
  const aiSummary = String((row.telephonyAiSummary as string | null) ?? "").trim();
  if (transcript || aiSummary) {
    return NextResponse.json({ error: "This call already has a transcript or AI summary." }, { status: 400 });
  }
  if (String((row.telephonyAiJobId as string | null) ?? "").trim()) {
    return NextResponse.json(
      { error: "RingCentral AI transcription is already queued for this call. Wait for it to finish or try again later." },
      { status: 409 },
    );
  }

  const locked = await lockCallLogForGeminiTranscription(callLogId);
  if (!locked) {
    return NextResponse.json(
      { error: "Transcription is already running for this call. Refresh in a moment." },
      { status: 409 },
    );
  }

  try {
    const audio = await fetchFirstCallLogRecordingBytes(callLogId);
    if (!audio) {
      await clearCallLogGeminiPending(callLogId);
      return NextResponse.json({ error: "No recording is linked to this call log yet." }, { status: 400 });
    }

    const happenedAt = new Date(String(row.happenedAt ?? ""));
    const happenedAtIso = Number.isNaN(happenedAt.getTime()) ? new Date().toISOString() : happenedAt.toISOString();

    const result = await transcribeCallRecordingWithGemini({
      audioBase64: audio.buffer.toString("base64"),
      mimeType: audio.mimeType,
      shopTimeZone: getAppTimezone(),
      happenedAtIso,
      direction: String(row.direction),
      telephonyResult: String((row.telephonyResult as string | null) ?? "").trim() || null,
      contactName: String((row.contactName as string | null) ?? "").trim() || null,
      contactPhone: String((row.contactPhone as string | null) ?? "").trim() || null,
    });

    await persistGeminiCallTranscription(callLogId, {
      transcript: result.transcript,
      summary: result.summary,
      structured: result.insights as Record<string, unknown>,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    await clearCallLogGeminiPending(callLogId);
    const message = e instanceof Error ? e.message : "Transcription failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
