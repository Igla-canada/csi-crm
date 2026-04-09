import "server-only";

/**
 * RingCentral call-log import: read-only GET of account/extension call logs + CRM upsert.
 * Does not answer, transfer, or otherwise control live calls.
 */

import { subHours } from "date-fns";

import {
  deleteCallLogWebhookTelephonyPlaceholder,
  sanitizeTelephonyContactName,
  type TelephonyWebhookSessionStubInput,
  upsertCallLogFromRingCentralImport,
  upsertCallLogFromTelephonyWebhookStub,
  type RingCentralImportedCall,
} from "@/lib/crm";
import { CallDirection } from "@/lib/db";
import { getRingCentralAutoTranscribe, getRingCentralEnv } from "@/lib/ringcentral/env";
import { getRingCentralPlatform } from "@/lib/ringcentral/platform";
import { dispositionFromRingCentralRecord } from "@/lib/ringcentral/call-result";
import {
  shouldStartAutoTranscriptionForCallLog,
  startRingCentralSpeechToTextForCallLog,
} from "@/lib/ringcentral/transcribe";

const MIN_DIGITS_LOOKUP = 7;

type RcParty = { phoneNumber?: string; name?: string };

type RcRecording = { id?: string; contentUri?: string; uri?: string };

type RcLeg = { recording?: RcRecording };

type RcCallRecord = {
  id?: string;
  sessionId?: string;
  /** Telephony session id (matches webhook session id in typical voice flows). */
  telephonySessionId?: string;
  startTime?: string;
  type?: string;
  direction?: string;
  from?: RcParty;
  to?: RcParty;
  recording?: RcRecording;
  legs?: RcLeg[];
};

type RecordingRef = { id: string; contentUri: string };

/** RingCentral often returns `id` + `uri` without `contentUri`; binary is at .../recording/{id}/content */
function normalizeRecordingRef(raw: RcRecording | undefined | null): RecordingRef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const id = raw.id != null ? String(raw.id).trim() : "";
  const contentUri = raw.contentUri != null ? String(raw.contentUri).trim() : "";
  if (contentUri) {
    return { id: id || "rc-recording", contentUri };
  }
  if (id) {
    return {
      id,
      contentUri: `/restapi/v1.0/account/~/recording/${encodeURIComponent(id)}/content`,
    };
  }
  return undefined;
}

function extractRecordingFromRcRecord(rec: RcCallRecord): RecordingRef | undefined {
  const top = normalizeRecordingRef(rec.recording);
  if (top) return top;
  const legs = rec.legs;
  if (!Array.isArray(legs)) return undefined;
  for (const leg of legs) {
    const hit = normalizeRecordingRef(leg?.recording);
    if (hit) return hit;
  }
  return undefined;
}

type RcCallLogListResponse = {
  records?: RcCallRecord[];
  paging?: { page?: number; totalPages?: number; perPage?: number };
};

function normalizeUsLookup(raw: string): { lookup: string; callLog10: string | null } {
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return { lookup: d, callLog10: d };
  if (d.length >= MIN_DIGITS_LOOKUP) return { lookup: d, callLog10: null };
  return { lookup: "", callLog10: null };
}

function mapDirection(raw: string | undefined): CallDirection | null {
  const d = String(raw ?? "").toLowerCase();
  if (d.includes("inbound")) return CallDirection.INBOUND;
  if (d.includes("outbound")) return CallDirection.OUTBOUND;
  return null;
}

function pickCustomerPhone(r: RcCallRecord): { digits: string; callLog10: string | null; name: string | null } | null {
  const dir = String(r.direction ?? "").toLowerCase();
  const party = dir.includes("outbound") ? r.to : r.from;
  const raw = String(party?.phoneNumber ?? "").trim();
  if (!raw) return null;
  const { lookup, callLog10 } = normalizeUsLookup(raw);
  if (lookup.length < MIN_DIGITS_LOOKUP) return null;
  return { digits: lookup, callLog10, name: party?.name ?? null };
}

function toImportedCall(
  rec: RcCallRecord,
  recording?: RecordingRef,
): RingCentralImportedCall | null {
  const id = String(rec.id ?? "").trim();
  if (!id) return null;
  const type = String(rec.type ?? "").toLowerCase();
  if (type && !type.includes("voice")) return null;

  const direction = mapDirection(rec.direction);
  if (!direction) return null;

  const phone = pickCustomerPhone(rec);
  if (!phone) return null;

  const start = rec.startTime ? new Date(rec.startTime) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  const resolvedRecording = recording ?? extractRecordingFromRcRecord(rec);
  const meta = rec as unknown as Record<string, unknown>;
  const disp = dispositionFromRingCentralRecord(meta, direction);

  return {
    ringCentralCallLogId: id,
    direction,
    happenedAt: start,
    phoneNormalized: phone.digits,
    contactPhone10: phone.callLog10,
    contactName: sanitizeTelephonyContactName(phone.name),
    recording: resolvedRecording,
    metadata: meta,
    telephonyResult: disp.resultLabel,
    telephonyCallbackPending: disp.callbackPending,
    telephonyAnsweredConnected: disp.answeredConnected,
  };
}

type RcPlatform = Awaited<ReturnType<typeof getRingCentralPlatform>>;

/**
 * Extension call log (JWT user) often carries `recording` even when account-level call log omits it.
 */
async function loadExtensionRecordingMaps(
  platform: RcPlatform,
  dateFrom: Date,
  dateTo: Date,
  errors: string[],
): Promise<{ byCallLogId: Map<string, RecordingRef>; bySessionId: Map<string, RecordingRef> }> {
  const byCallLogId = new Map<string, RecordingRef>();
  const bySessionId = new Map<string, RecordingRef>();
  let page = 1;
  const perPage = 250;
  for (;;) {
    const resp = await platform.get("/restapi/v1.0/account/~/extension/~/call-log", {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      page,
      perPage,
      type: "Voice",
      view: "Detailed",
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      errors.push(`Extension call-log page ${page}: HTTP ${resp.status} ${text.slice(0, 200)}`);
      break;
    }
    const body = (await resp.json()) as RcCallLogListResponse;
    const records = body.records ?? [];
    for (const rec of records) {
      const r = extractRecordingFromRcRecord(rec);
      if (!r) continue;
      const cid = String(rec.id ?? "").trim();
      const sid = String(rec.sessionId ?? "").trim();
      if (cid) byCallLogId.set(cid, r);
      if (sid) bySessionId.set(sid, r);
    }
    const totalPages = body.paging?.totalPages;
    const lastPage =
      records.length === 0 ||
      (typeof totalPages === "number" && page >= totalPages) ||
      records.length < perPage;
    if (lastPage) break;
    page += 1;
  }
  return { byCallLogId, bySessionId };
}

function mergeRecordingFromExtensionIndex(
  rec: RcCallRecord,
  byCallLogId: Map<string, RecordingRef>,
  bySessionId: Map<string, RecordingRef>,
): RecordingRef | undefined {
  const direct = extractRecordingFromRcRecord(rec);
  if (direct) return direct;
  const cid = String(rec.id ?? "").trim();
  const sid = String(rec.sessionId ?? "").trim();
  return (cid ? byCallLogId.get(cid) : undefined) ?? (sid ? bySessionId.get(sid) : undefined);
}

export type SyncRingCentralVoiceCallLogsResult = {
  fetched: number;
  upserted: number;
  skipped: number;
  transcribeStarted: number;
  /** Non-fatal issues (e.g. missing RingCentral AI scope while auto-transcribe is on). */
  warnings: string[];
  errors: string[];
};

function isRingCentralAiPermissionMessage(msg: string): boolean {
  return /\[AI\]\s*permission|AI\] permission|needs to have \[AI\]/i.test(msg);
}

/**
 * Pulls account-level voice call log (all extensions) and merges recording metadata from the JWT user’s extension log when needed.
 */
export async function syncRingCentralVoiceCallLogsFromApi(options: {
  hoursBack?: number;
} = {}): Promise<SyncRingCentralVoiceCallLogsResult> {
  const env = getRingCentralEnv();
  if (!env) {
    throw new Error("RingCentral is not configured.");
  }

  const hoursBack = Math.min(Math.max(options.hoursBack ?? 48, 1), 168);
  const dateTo = new Date();
  const dateFrom = subHours(dateTo, hoursBack);

  const platform = await getRingCentralPlatform();
  const autoTx = getRingCentralAutoTranscribe();

  const result: SyncRingCentralVoiceCallLogsResult = {
    fetched: 0,
    upserted: 0,
    skipped: 0,
    transcribeStarted: 0,
    warnings: [],
    errors: [],
  };

  let aiPermissionWarningAdded = false;

  const { byCallLogId, bySessionId } = await loadExtensionRecordingMaps(platform, dateFrom, dateTo, result.errors);

  let page = 1;
  const perPage = 250;

  for (;;) {
    const resp = await platform.get("/restapi/v1.0/account/~/call-log", {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      page,
      perPage,
      type: "Voice",
      view: "Detailed",
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      result.errors.push(`Account call-log page ${page}: HTTP ${resp.status} ${text.slice(0, 200)}`);
      break;
    }

    const body = (await resp.json()) as RcCallLogListResponse;
    const records = body.records ?? [];
    result.fetched += records.length;

    for (const rec of records) {
      const merged = mergeRecordingFromExtensionIndex(rec, byCallLogId, bySessionId);
      const imported = toImportedCall(rec, merged);
      if (!imported) {
        result.skipped += 1;
        continue;
      }
      try {
        const { callLogId } = await upsertCallLogFromRingCentralImport(imported, env.integrationUserId);
        result.upserted += 1;

        const wantTx =
          autoTx &&
          Boolean(imported.recording?.contentUri) &&
          (await shouldStartAutoTranscriptionForCallLog(callLogId));

        if (wantTx) {
          try {
            const tx = await startRingCentralSpeechToTextForCallLog(callLogId);
            if (tx.ok) {
              result.transcribeStarted += 1;
            } else if (tx.message && isRingCentralAiPermissionMessage(tx.message)) {
              if (!aiPermissionWarningAdded) {
                result.warnings.push(
                  "Auto-transcription is off: your RingCentral app does not have the AI permission. Add the AI scope in the developer portal (RingCentral may need to enable it), or set RINGCENTRAL_AUTO_TRANSCRIBE=false in .env.",
                );
                aiPermissionWarningAdded = true;
              }
            } else if (tx.message) {
              result.warnings.push(`Transcription skipped for a call: ${tx.message}`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (isRingCentralAiPermissionMessage(msg)) {
              if (!aiPermissionWarningAdded) {
                result.warnings.push(
                  "Auto-transcription is off: your RingCentral app does not have the AI permission. Add the AI scope in the developer portal (RingCentral may need to enable it), or set RINGCENTRAL_AUTO_TRANSCRIBE=false in .env.",
                );
                aiPermissionWarningAdded = true;
              }
            } else {
              result.warnings.push(`Transcription error: ${msg}`);
            }
          }
        }
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }

    const totalPages = body.paging?.totalPages;
    const lastPage =
      records.length === 0 ||
      (typeof totalPages === "number" && page >= totalPages) ||
      records.length < perPage;
    if (lastPage) break;
    page += 1;
  }

  return result;
}

function recordMatchesTelephonySession(rec: RcCallRecord, telephonySessionId: string): boolean {
  const want = telephonySessionId.trim();
  if (!want) return false;
  const ts = String(rec.telephonySessionId ?? "").trim();
  if (ts && ts === want) return true;
  const sid = String(rec.sessionId ?? "").trim();
  return Boolean(sid && sid === want);
}

const TELEPHONY_END_IMPORT_HOURS_BACK = 8;
const TELEPHONY_END_IMPORT_MAX_PAGES = 14;

/**
 * When a telephony session ends (webhook), try to import the matching account call-log row immediately.
 * If RingCentral has not published it yet, writes a `webhook-ts:{session}` placeholder (same path as full sync).
 */
export async function importCallLogForTelephonySessionEnd(stub: TelephonyWebhookSessionStubInput): Promise<void> {
  const env = getRingCentralEnv();
  if (!env) {
    return;
  }

  const sessionId = stub.telephonySessionId.trim();
  if (!sessionId) {
    return;
  }

  const platform = await getRingCentralPlatform();
  const dateTo = new Date();
  const dateFrom = subHours(dateTo, TELEPHONY_END_IMPORT_HOURS_BACK);

  let page = 1;
  const perPage = 100;
  let matched: RcCallRecord | null = null;

  for (; page <= TELEPHONY_END_IMPORT_MAX_PAGES; page++) {
    const resp = await platform.get("/restapi/v1.0/account/~/call-log", {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      page,
      perPage,
      type: "Voice",
      view: "Detailed",
    });

    if (!resp.ok) {
      if (process.env.NODE_ENV === "development") {
        const text = await resp.text().catch(() => "");
        console.warn(
          `[telephony-session-import] call-log lookup HTTP ${resp.status} for session ${sessionId.slice(0, 24)}… ${text.slice(0, 120)}`,
        );
      }
      break;
    }

    const body = (await resp.json()) as RcCallLogListResponse;
    const records = body.records ?? [];

    for (const rec of records) {
      if (recordMatchesTelephonySession(rec, sessionId)) {
        matched = rec;
        break;
      }
    }
    if (matched) break;

    const totalPages = body.paging?.totalPages;
    const lastPage =
      records.length === 0 ||
      (typeof totalPages === "number" && page >= totalPages) ||
      records.length < perPage;
    if (lastPage) break;
  }

  if (matched) {
    const merged = extractRecordingFromRcRecord(matched);
    const imported = toImportedCall(matched, merged);
    if (imported) {
      await deleteCallLogWebhookTelephonyPlaceholder(sessionId);
      const { callLogId } = await upsertCallLogFromRingCentralImport(imported, env.integrationUserId);

      const autoTx = getRingCentralAutoTranscribe();
      if (autoTx && imported.recording?.contentUri) {
        try {
          if (await shouldStartAutoTranscriptionForCallLog(callLogId)) {
            await startRingCentralSpeechToTextForCallLog(callLogId);
          }
        } catch {
          /* non-fatal */
        }
      }
      return;
    }
  }

  await upsertCallLogFromTelephonyWebhookStub(stub, env.integrationUserId);
}
