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
import { recordingPathFromStoredRef, stableRecordingIdForPath } from "@/lib/ringcentral/recording-content-path";
import { getRingCentralPlatform } from "@/lib/ringcentral/platform";
import { dispositionFromRingCentralRecord } from "@/lib/ringcentral/call-result";
import {
  shouldStartAutoTranscriptionForCallLog,
  startRingCentralSpeechToTextForCallLog,
} from "@/lib/ringcentral/transcribe";

const MIN_DIGITS_LOOKUP = 7;

type RcParty = { phoneNumber?: string; name?: string };

type RcRecording = { id?: string; contentUri?: string; uri?: string };

type RcLeg = { recording?: RcRecording; from?: RcParty; to?: RcParty; result?: string; action?: string };

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
  /** Some responses include multiple top-level recording objects (e.g. segments). */
  recordings?: RcRecording[];
  recording?: RcRecording;
  legs?: RcLeg[];
};

type RecordingRef = { id: string; contentUri: string };

/**
 * RingCentral may send `contentUri`, or only `uri` (absolute URL or API path), or only `id`
 * (binary at .../recording/{id}/content).
 */
function normalizeRecordingRef(raw: RcRecording | undefined | null): RecordingRef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const path = recordingPathFromStoredRef(o);
  if (!path) return undefined;
  const id = stableRecordingIdForPath(path, String(o.id ?? ""));
  return { id, contentUri: path };
}

/** Dedupe by recording id; order = top-level `recording`, `recordings[]`, then each leg’s `recording` (hold/transfer legs). */
function extractAllRecordingsFromRcRecord(rec: RcCallRecord): RecordingRef[] {
  const out: RecordingRef[] = [];
  const seen = new Set<string>();
  const push = (raw: RcRecording | undefined | null) => {
    const n = normalizeRecordingRef(raw);
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
  };
  push(rec.recording);
  const topList = rec.recordings;
  if (Array.isArray(topList)) {
    for (const r of topList) push(r);
  }
  const legs = rec.legs;
  if (Array.isArray(legs)) {
    for (const leg of legs) {
      push(leg?.recording);
    }
  }
  return out;
}

function mergeRecordingRefsInOrder(...parts: (RecordingRef[] | undefined)[]): RecordingRef[] {
  const seen = new Set<string>();
  const out: RecordingRef[] = [];
  for (const part of parts) {
    if (!part?.length) continue;
    for (const r of part) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
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

function tryPartyPhone(party: RcParty | undefined): { digits: string; callLog10: string | null; name: string | null } | null {
  const raw = String(party?.phoneNumber ?? "").trim();
  if (!raw) return null;
  const { lookup, callLog10 } = normalizeUsLookup(raw);
  if (lookup.length < MIN_DIGITS_LOOKUP) return null;
  return { digits: lookup, callLog10, name: party?.name ?? null };
}

/**
 * Resolves external party phone for CRM matching. Falls back to leg-level from/to (transfers, FindMe, park)
 * and finally imports with no dialable digits so rows still sync (Telus-style multi-leg logs often omit top-level `from`).
 */
function pickCustomerPhoneForImport(
  r: RcCallRecord,
): { digits: string; callLog10: string | null; name: string | null } {
  const dir = String(r.direction ?? "").toLowerCase();
  const inbound = dir.includes("inbound");
  const partyOrder = (inbound ? [r.from, r.to] : [r.to, r.from]).filter(
    (p): p is RcParty => p != null && typeof p === "object",
  );
  for (const p of partyOrder) {
    const hit = tryPartyPhone(p);
    if (hit) return hit;
  }
  const legs = r.legs;
  if (Array.isArray(legs)) {
    for (const leg of legs) {
      if (!leg || typeof leg !== "object") continue;
      const L = leg as RcLeg;
      const order = inbound ? [L.from, L.to] : [L.to, L.from];
      for (const p of order) {
        const hit = tryPartyPhone(p);
        if (hit) return hit;
      }
    }
  }
  let nameHint: string | null = null;
  for (const p of partyOrder) {
    const n = p?.name?.trim();
    if (n && n.length >= 2) {
      nameHint = n;
      break;
    }
  }
  return {
    digits: "",
    callLog10: null,
    name: sanitizeTelephonyContactName(nameHint),
  };
}

function isExcludedNonVoiceCallType(typeLower: string): boolean {
  if (!typeLower) return false;
  return (
    typeLower.includes("fax") ||
    typeLower.includes("pager") ||
    typeLower.includes("sms") ||
    typeLower.includes("text")
  );
}

function toImportedCall(rec: RcCallRecord, extraRecordings?: RecordingRef[]): RingCentralImportedCall | null {
  const id = String(rec.id ?? "").trim();
  if (!id) return null;
  const type = String(rec.type ?? "").toLowerCase();
  if (isExcludedNonVoiceCallType(type)) return null;
  /* List requests already use `type=Voice`; do not drop rows on unknown `type` strings (TELUS / RC variants). */

  const direction = mapDirection(rec.direction);
  if (!direction) return null;

  const phone = pickCustomerPhoneForImport(rec);

  const start = rec.startTime ? new Date(rec.startTime) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  const merged = mergeRecordingRefsInOrder(extractAllRecordingsFromRcRecord(rec), extraRecordings);
  const primary = merged[0];
  const meta = rec as unknown as Record<string, unknown>;
  const disp = dispositionFromRingCentralRecord(meta, direction);

  return {
    ringCentralCallLogId: id,
    direction,
    happenedAt: start,
    phoneNormalized: phone.digits,
    contactPhone10: phone.callLog10,
    contactName: sanitizeTelephonyContactName(phone.name),
    recording: primary,
    recordings: merged.length > 0 ? merged : undefined,
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
function mergeRecordingMapEntry(map: Map<string, RecordingRef[]>, key: string, refs: RecordingRef[]) {
  if (!key || !refs.length) return;
  const prev = map.get(key) ?? [];
  map.set(key, mergeRecordingRefsInOrder(prev, refs));
}

async function loadExtensionRecordingMaps(
  platform: RcPlatform,
  dateFrom: Date,
  dateTo: Date,
  errors: string[],
): Promise<{ byCallLogId: Map<string, RecordingRef[]>; bySessionId: Map<string, RecordingRef[]> }> {
  const byCallLogId = new Map<string, RecordingRef[]>();
  const bySessionId = new Map<string, RecordingRef[]>();
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
      const all = extractAllRecordingsFromRcRecord(rec);
      if (!all.length) continue;
      const cid = String(rec.id ?? "").trim();
      const sid = String(rec.sessionId ?? "").trim();
      if (cid) mergeRecordingMapEntry(byCallLogId, cid, all);
      if (sid) mergeRecordingMapEntry(bySessionId, sid, all);
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

/** Extension log often has per-leg recordings missing from the company call-log row. */
function extensionRecordingExtrasForCall(
  rec: RcCallRecord,
  byCallLogId: Map<string, RecordingRef[]>,
  bySessionId: Map<string, RecordingRef[]>,
): RecordingRef[] {
  const cid = String(rec.id ?? "").trim();
  const sid = String(rec.sessionId ?? "").trim();
  return mergeRecordingRefsInOrder(
    cid ? byCallLogId.get(cid) : undefined,
    sid ? bySessionId.get(sid) : undefined,
  );
}

/** One detailed extension row sometimes includes `recording` before the list index is populated. */
async function tryFetchExtensionCallLogDetailRecordings(
  platform: RcPlatform,
  callLogId: string,
): Promise<RecordingRef[]> {
  const id = callLogId.trim();
  if (!id) return [];
  const path = `/restapi/v1.0/account/~/extension/~/call-log/${encodeURIComponent(id)}`;
  const resp = await platform.get(path, { view: "Detailed" });
  if (!resp.ok) return [];
  try {
    const rec = (await resp.json()) as RcCallRecord;
    return extractAllRecordingsFromRcRecord(rec);
  } catch {
    return [];
  }
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

/** Hard cap on how wide a single RingCentral sync window can be (matches inbound-history guard). */
const MAX_RC_SYNC_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

export type SyncRingCentralVoiceCallLogsOptions = {
  hoursBack?: number;
  /** When set, queries RingCentral for this `happenedAt` window instead of rolling `hoursBack`. */
  happenedAtRange?: { from: Date; to: Date };
};

/**
 * Pulls account-level voice call log (all extensions) and merges recording metadata from the JWT user’s extension log when needed.
 */
export async function syncRingCentralVoiceCallLogsFromApi(
  options: SyncRingCentralVoiceCallLogsOptions = {},
): Promise<SyncRingCentralVoiceCallLogsResult> {
  const env = getRingCentralEnv();
  if (!env) {
    throw new Error("RingCentral is not configured.");
  }

  let dateFrom: Date;
  let dateTo: Date;
  if (options.happenedAtRange) {
    dateFrom = options.happenedAtRange.from;
    dateTo = options.happenedAtRange.to;
    if (dateFrom.getTime() > dateTo.getTime()) {
      throw new Error("Invalid sync date range.");
    }
    const now = new Date();
    if (dateTo > now) dateTo = now;
    if (dateTo.getTime() - dateFrom.getTime() > MAX_RC_SYNC_SPAN_MS) {
      dateFrom = new Date(dateTo.getTime() - MAX_RC_SYNC_SPAN_MS);
    }
  } else {
    const hoursBack = Math.min(Math.max(options.hoursBack ?? 48, 1), 168);
    dateTo = new Date();
    dateFrom = subHours(dateTo, hoursBack);
  }

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
      const fromSiblingsOnPage = mergeRecordingRefsInOrder(
        ...records
          .filter((r) => r !== rec && sameTelephonySession(rec, r))
          .map((r) => extractAllRecordingsFromRcRecord(r)),
      );
      const extra = mergeRecordingRefsInOrder(
        fromSiblingsOnPage,
        extensionRecordingExtrasForCall(rec, byCallLogId, bySessionId),
      );
      const imported = toImportedCall(rec, extra);
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

function sameTelephonySession(a: RcCallRecord, b: RcCallRecord): boolean {
  const tsA = String(a.telephonySessionId ?? "").trim();
  const tsB = String(b.telephonySessionId ?? "").trim();
  if (tsA && tsA === tsB) return true;
  const sA = String(a.sessionId ?? "").trim();
  const sB = String(b.sessionId ?? "").trim();
  return Boolean(sA && sA === sB);
}

const TELEPHONY_END_IMPORT_HOURS_BACK = 8;
/** Account-level voice volume can exceed a few pages; session-end import must still find the row we just hung up. */
const TELEPHONY_END_IMPORT_MAX_PAGES = 40;

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

  const directionFilter =
    stub.direction === CallDirection.INBOUND
      ? "Inbound"
      : stub.direction === CallDirection.OUTBOUND
        ? "Outbound"
        : undefined;

  let page = 1;
  const perPage = 100;
  /** Transfers can yield multiple company call-log rows with the same session id — collect all for recordings. */
  const matchedById = new Map<string, RcCallRecord>();

  for (; page <= TELEPHONY_END_IMPORT_MAX_PAGES; page++) {
    const query: Record<string, string | number> = {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      page,
      perPage,
      type: "Voice",
      view: "Detailed",
    };
    if (directionFilter) query.direction = directionFilter;

    const resp = await platform.get("/restapi/v1.0/account/~/call-log", query);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(
        `[telephony-session-import] call-log lookup HTTP ${resp.status} for session ${sessionId.slice(0, 24)}… ${text.slice(0, 200)}`,
      );
      break;
    }

    const body = (await resp.json()) as RcCallLogListResponse;
    const records = body.records ?? [];

    for (const rec of records) {
      if (recordMatchesTelephonySession(rec, sessionId)) {
        const rid = String(rec.id ?? "").trim();
        if (rid) matchedById.set(rid, rec);
      }
    }

    const totalPages = body.paging?.totalPages;
    const lastPage =
      records.length === 0 ||
      (typeof totalPages === "number" && page >= totalPages) ||
      records.length < perPage;
    if (lastPage) break;
  }

  const matchedList = [...matchedById.values()].sort((a, b) => {
    const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
    const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
    return ta - tb;
  });

  if (matchedList.length > 0) {
    const primary = matchedList[0];
    const siblings = matchedList.slice(1);
    const extErrors: string[] = [];
    const { byCallLogId, bySessionId } = await loadExtensionRecordingMaps(platform, dateFrom, dateTo, extErrors);
    for (const msg of extErrors) {
      console.warn(`[telephony-session-import] extension call-log map: ${msg}`);
    }
    const fromSiblingRows = mergeRecordingRefsInOrder(...siblings.map((r) => extractAllRecordingsFromRcRecord(r)));
    const fromExt = mergeRecordingRefsInOrder(
      ...matchedList.map((r) => extensionRecordingExtrasForCall(r, byCallLogId, bySessionId)),
    );
    const cid = String(primary.id ?? "").trim();
    const fromDetail = await tryFetchExtensionCallLogDetailRecordings(platform, cid);
    const imported = toImportedCall(
      primary,
      mergeRecordingRefsInOrder(fromSiblingRows, fromExt, fromDetail),
    );
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
