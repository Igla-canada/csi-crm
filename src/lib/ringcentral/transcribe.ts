import "server-only";

import { getSupabaseAdmin, tables } from "@/lib/db";
import { setCallLogTelephonyAiJobId } from "@/lib/crm";
import { getAppPublicUrl, getRingCentralEnv, getRingCentralWebhookSecret } from "@/lib/ringcentral/env";
import { getRingCentralPlatform } from "@/lib/ringcentral/platform";

function joinRecordingContentUriWithToken(contentUri: string, accessToken: string): string {
  const env = getRingCentralEnv();
  if (!env) throw new Error("RingCentral is not configured.");
  const base =
    contentUri.startsWith("http://") || contentUri.startsWith("https://")
      ? contentUri
      : `${env.serverUrl.replace(/\/$/, "")}${contentUri.startsWith("/") ? "" : "/"}${contentUri}`;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}access_token=${encodeURIComponent(accessToken)}`;
}

/**
 * Starts async RingCentral AI speech-to-text; results POST to `/api/ringcentral/ai-webhook`.
 * Persists `telephonyAiJobId` on the call log when the API returns 202 + jobId.
 */
export async function startRingCentralSpeechToTextForCallLog(callLogId: string): Promise<{
  ok: boolean;
  jobId?: string;
  message?: string;
}> {
  const baseUrl = getAppPublicUrl();
  if (!baseUrl) {
    return { ok: false, message: "Set APP_URL (public base URL) so RingCentral can call the AI webhook." };
  }

  const sb = getSupabaseAdmin();
  const { data: row, error: fErr } = await sb
    .from(tables.CallLog)
    .select("id,telephonyRecordingContentUri")
    .eq("id", callLogId)
    .maybeSingle();
  if (fErr) throw fErr;
  const uri = String((row?.telephonyRecordingContentUri as string | undefined) ?? "").trim();
  if (!row || !uri) {
    return { ok: false, message: "This call log has no RingCentral recording URI." };
  }

  const platform = await getRingCentralPlatform();
  const auth = await platform.auth().data();
  const token = auth.access_token;
  if (!token) {
    return { ok: false, message: "RingCentral access token missing." };
  }

  const contentUri = joinRecordingContentUriWithToken(uri, token);
  const secret = getRingCentralWebhookSecret();
  const webhookPath =
    secret != null
      ? `${baseUrl}/api/ringcentral/ai-webhook?token=${encodeURIComponent(secret)}`
      : `${baseUrl}/api/ringcentral/ai-webhook`;
  const endpoint = `/ai/audio/v1/async/speech-to-text?webhook=${encodeURIComponent(webhookPath)}`;

  let resp: Response;
  try {
    resp = await platform.post(endpoint, {
      contentUri,
      encoding: "Mpeg",
      languageCode: "en-US",
      source: "RingCentral",
      audioType: "CallCenter",
      enablePunctuation: true,
      enableSpeakerDiarization: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg || "RingCentral AI request failed." };
  }

  const json = (await resp.json().catch(() => null)) as { jobId?: string; message?: string } | null;
  if (resp.status !== 202 || !json?.jobId) {
    const detail =
      json && typeof json === "object" && typeof json.message === "string"
        ? json.message
        : await resp.text().catch(() => "");
    return {
      ok: false,
      message: detail?.trim() || `RingCentral AI returned HTTP ${resp.status}.`,
    };
  }

  await setCallLogTelephonyAiJobId(callLogId, json.jobId);
  return { ok: true, jobId: json.jobId };
}

/** True when auto-transcribe (or manual request) should be allowed to start a new AI job. */
export async function shouldStartAutoTranscriptionForCallLog(callLogId: string): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from(tables.CallLog)
    .select("telephonyTranscript,telephonyAiJobId")
    .eq("id", callLogId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  if (String((data.telephonyTranscript as string | null) ?? "").trim()) return false;
  if (String((data.telephonyAiJobId as string | null) ?? "").trim()) return false;
  return true;
}
