import "server-only";

import { parseTelephonyRecordingRefsJson } from "@/lib/crm";
import { getSupabaseAdmin, tables } from "@/lib/db";
import { recordingPathFromStoredRef } from "@/lib/ringcentral/recording-content-path";
import { getRingCentralPlatform } from "@/lib/ringcentral/platform";

/** RingCentral → Gemini inline limit (~20 MB); keep headroom for base64 expansion server-side. */
const MAX_RECORDING_BYTES = 12 * 1024 * 1024;

export async function fetchFirstCallLogRecordingBytes(callLogId: string): Promise<{
  buffer: Buffer;
  mimeType: string;
} | null> {
  const sb = getSupabaseAdmin();
  const { data: row, error } = await sb
    .from(tables.CallLog)
    .select("telephonyRecordingContentUri,telephonyRecordingRefs")
    .eq("id", callLogId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  let uri = "";
  const parsedRefs = parseTelephonyRecordingRefsJson(row.telephonyRecordingRefs);
  if (parsedRefs?.length) {
    uri = parsedRefs[0]!.contentUri;
  }
  if (!uri) {
    uri = recordingPathFromStoredRef({
      contentUri: (row.telephonyRecordingContentUri as string | undefined) ?? "",
    });
  }
  if (!uri) return null;

  const platform = await getRingCentralPlatform();
  const rcResp = await platform.get(uri, undefined, undefined);
  if (!rcResp.ok) {
    const detail = await rcResp.text().catch(() => "");
    throw new Error(
      `RingCentral recording returned HTTP ${rcResp.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const ab = await rcResp.arrayBuffer();
  if (ab.byteLength > MAX_RECORDING_BYTES) {
    const mb = Math.ceil(ab.byteLength / 1024 / 1024);
    const maxMb = MAX_RECORDING_BYTES / 1024 / 1024;
    throw new Error(`Recording is about ${mb} MB; Gemini transcription allows up to ~${maxMb} MB for this flow.`);
  }

  const mimeType =
    rcResp.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "audio/mpeg";
  return { buffer: Buffer.from(ab), mimeType };
}
