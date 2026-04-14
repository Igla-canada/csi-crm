import "server-only";

/**
 * RingCentral call-log import: read-only GET of account/extension call logs + CRM upsert.
 * Does not answer, transfer, or otherwise control live calls.
 */

import { addHours, subHours } from "date-fns";

import {
  applyRingCentralImportToExistingCallLogById,
  deleteCallLogWebhookTelephonyPlaceholder,
  sanitizeTelephonyContactName,
  WEBHOOK_TELEPHONY_LOG_ID_PREFIX,
  type TelephonyWebhookSessionStubInput,
  upsertCallLogFromRingCentralImport,
  upsertCallLogFromTelephonyWebhookStub,
  type RingCentralImportedCall,
} from "@/lib/crm";
import { CallDirection, getSupabaseAdmin, tables } from "@/lib/db";
import { getRingCentralAutoTranscribe, getRingCentralEnv } from "@/lib/ringcentral/env";
import { recordingPathFromStoredRef, stableRecordingIdForPath } from "@/lib/ringcentral/recording-content-path";
import { getRingCentralPlatform } from "@/lib/ringcentral/platform";
import {
  dispositionFromRingCentralRecordWithSessionContext,
  ringCentralResultLooksAnsweredConnectedRaw,
} from "@/lib/ringcentral/call-result";
import {
  shouldStartAutoTranscriptionForCallLog,
  startRingCentralSpeechToTextForCallLog,
} from "@/lib/ringcentral/transcribe";

const MIN_DIGITS_LOOKUP = 7;

type RcParty = { phoneNumber?: string; name?: string };

type RcRecording = { id?: string; contentUri?: string; uri?: string };

type RcLeg = {
  recording?: RcRecording;
  /** Some carriers expose multiple fragments on one leg (TELUS / forwarded flows). */
  recordings?: RcRecording[];
  /** Leg-level direction (FindMe / transfer rows often differ from the parent call-log row). */
  direction?: string;
  from?: RcParty;
  to?: RcParty;
  result?: string;
  action?: string;
  /** Nested legs (forwarding / FindMe trees in Detailed view). */
  legs?: RcLeg[];
};

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

function pushRecordingFieldsOnLeg(leg: RcLeg, push: (raw: RcRecording | undefined | null) => void): void {
  push(leg.recording);
  const sub = leg.recordings;
  if (Array.isArray(sub)) {
    for (const r of sub) push(r);
  }
}

/** Some carriers return a single leg object instead of a one-element `legs` array. */
function normalizeLegsArray(raw: RcLeg[] | RcLeg | undefined | null): RcLeg[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") return [raw as RcLeg];
  return [];
}

/**
 * TELUS / RC variants sometimes nest `recording` under uncommon keys. Avoid treating arbitrary `{ id }` as a recording:
 * require a URI, a `/recording/` path, or a recording-like `type` with an id.
 */
function isLikelyRingCentralRecordingPayload(o: Record<string, unknown>): boolean {
  const contentUri = String(o.contentUri ?? "").trim();
  if (contentUri) return true;
  const uri = String(o.uri ?? "").trim();
  if (uri && /\/recording\//i.test(uri)) return true;
  const id = String(o.id ?? "").trim();
  if (!id) return false;
  const ty = String(o.type ?? "").trim();
  if (/^(automatic|on[- ]?demand|audio)/i.test(ty)) return true;
  return false;
}

const DEEP_SCAN_RECORDING_MAX_NODES = 220;

/** Breadth-first scan for recording objects missed by typed `legs` walking (carrier-specific shapes). */
function deepScanRecordingPayloads(root: unknown, push: (raw: RcRecording | undefined | null) => void): void {
  const queue: unknown[] = [root];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (queue.length > 0 && nodes < DEEP_SCAN_RECORDING_MAX_NODES) {
    const cur = queue.shift();
    nodes += 1;
    if (cur == null || typeof cur !== "object") continue;
    if (seen.has(cur as object)) continue;
    seen.add(cur as object);
    if (Array.isArray(cur)) {
      for (const x of cur) queue.push(x);
      continue;
    }
    const o = cur as Record<string, unknown>;
    if (isLikelyRingCentralRecordingPayload(o)) {
      push(o as RcRecording);
      continue;
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") queue.push(v);
    }
  }
}

/** Walk nested `legs` (FindMe / transfer trees in Detailed call-log). */
function walkLegsForRecordings(legs: RcLeg[] | RcLeg | undefined, push: (raw: RcRecording | undefined | null) => void): void {
  const list = normalizeLegsArray(legs);
  for (const leg of list) {
    if (!leg || typeof leg !== "object") continue;
    pushRecordingFieldsOnLeg(leg, push);
    walkLegsForRecordings(leg.legs, push);
  }
}

/** Dedupe by recording id; order = top-level `recording`, `recordings[]`, then each leg (recursive). */
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
  walkLegsForRecordings(rec.legs, push);
  deepScanRecordingPayloads(rec, push);
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

function forEachLegDepthFirst(legs: RcLeg[] | RcLeg | undefined, fn: (leg: RcLeg) => void): void {
  for (const leg of normalizeLegsArray(legs)) {
    fn(leg);
    forEachLegDepthFirst(leg.legs, fn);
  }
}

function directionLooksInbound(raw: string | undefined): boolean {
  return String(raw ?? "").toLowerCase().includes("inbound");
}

function directionLooksOutbound(raw: string | undefined): boolean {
  return String(raw ?? "").toLowerCase().includes("outbound");
}

/**
 * PSTN caller on an **inbound** leg (`from`) — survives internal forward/FindMe rows that are `outbound`.
 */
function recordHasInboundCustomerOnFrom(rec: RcCallRecord, customerDigits: string): boolean {
  if (customerDigits.length < MIN_DIGITS_LOOKUP) return false;
  const fromMatches = (from: RcParty | undefined) => tryPartyPhone(from)?.digits === customerDigits;
  if (directionLooksInbound(rec.direction) && fromMatches(rec.from)) return true;
  let found = false;
  forEachLegDepthFirst(rec.legs, (leg) => {
    if (found) return;
    if (directionLooksInbound(leg.direction) && fromMatches(leg.from)) found = true;
  });
  return found;
}

/** We placed an outbound call to the customer (`to` on an outbound leg). */
function recordHasOutboundCustomerOnTo(rec: RcCallRecord, customerDigits: string): boolean {
  if (customerDigits.length < MIN_DIGITS_LOOKUP) return false;
  const toMatches = (to: RcParty | undefined) => tryPartyPhone(to)?.digits === customerDigits;
  if (directionLooksOutbound(rec.direction) && toMatches(rec.to)) return true;
  let found = false;
  forEachLegDepthFirst(rec.legs, (leg) => {
    if (found) return;
    if (directionLooksOutbound(leg.direction) && toMatches(leg.to)) found = true;
  });
  return found;
}

/**
 * If the customer's number appears only as `from` across the whole tree → they called us.
 * Only as `to` → we dialed them. Both or neither → unknown (caller should use session-level rules).
 */
function inferCustomerCallDirectionFromRecordLegacy(rec: RcCallRecord, customerDigits: string): CallDirection | null {
  if (customerDigits.length < MIN_DIGITS_LOOKUP) return null;
  let seenFrom = false;
  let seenTo = false;
  const touch = (p: RcParty | undefined, side: "from" | "to") => {
    const hit = tryPartyPhone(p);
    if (!hit || hit.digits !== customerDigits) return;
    if (side === "from") seenFrom = true;
    else seenTo = true;
  };
  touch(rec.from, "from");
  touch(rec.to, "to");
  forEachLegDepthFirst(rec.legs, (leg) => {
    touch(leg.from, "from");
    touch(leg.to, "to");
  });
  if (seenFrom && !seenTo) return CallDirection.INBOUND;
  if (seenTo && !seenFrom) return CallDirection.OUTBOUND;
  return null;
}

function rcRecordStartTimeMs(r: RcCallRecord): number {
  const t = r.startTime ? new Date(r.startTime).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Fallback direction when customer-number matching is ambiguous: use the first directional row in session time order. */
function resolveSessionDirectionByChronology(records: RcCallRecord[]): CallDirection | null {
  const ordered = dedupeRcRecordsById(records).sort((a, b) => rcRecordStartTimeMs(a) - rcRecordStartTimeMs(b));
  for (const r of ordered) {
    const d = mapDirection(r.direction);
    if (d) return d;
  }
  return null;
}

/**
 * Prefer **inbound PSTN-from** on any session fragment before **outbound PSTN-to**, so hunt groups and
 * unconditional forwards (101→202) do not flip the CRM row to outgoing just because the primary RC id is an internal leg.
 *
 * Rows are processed **chronologically** so the first PSTN interaction (true customer direction) wins over
 * later FindMe / park tails that reuse the same session graph.
 */
function resolveRingCentralCustomerDirection(
  primary: RcCallRecord,
  customerDigits: string,
  contextRecords: RcCallRecord[] | undefined,
): CallDirection | null {
  if (customerDigits.length < MIN_DIGITS_LOOKUP) return null;
  const records = dedupeRcRecordsById([primary, ...(contextRecords ?? [])]).sort(
    (a, b) => rcRecordStartTimeMs(a) - rcRecordStartTimeMs(b),
  );

  for (const r of records) {
    if (recordHasInboundCustomerOnFrom(r, customerDigits)) return CallDirection.INBOUND;
  }
  for (const r of records) {
    if (recordHasOutboundCustomerOnTo(r, customerDigits)) return CallDirection.OUTBOUND;
  }
  for (const r of records) {
    const d = inferCustomerCallDirectionFromRecordLegacy(r, customerDigits);
    if (d) return d;
  }
  return null;
}

function dedupeRcRecordsById(records: RcCallRecord[]): RcCallRecord[] {
  const m = new Map<string, RcCallRecord>();
  for (const r of records) {
    const id = String(r.id ?? "").trim();
    if (id) m.set(id, r);
  }
  return [...m.values()];
}

/**
 * Resolves external party phone for CRM matching. Falls back to leg-level from/to (transfers, FindMe, park)
 * and finally imports with no dialable digits so rows still sync (Telus-style multi-leg logs often omit top-level `from`).
 *
 * Prefer the caller on any **Inbound** segment first (matches live telephony webhook behavior). Internal outbound
 * legs (FindMe, park) often lack the customer on `from`/`to` order that top-level `direction=Outbound` implies.
 */
function pickCustomerPhoneForImport(
  r: RcCallRecord,
): { digits: string; callLog10: string | null; name: string | null } {
  if (String(r.direction ?? "").toLowerCase().includes("inbound")) {
    const hit = tryPartyPhone(r.from);
    if (hit) return hit;
  }
  let inboundLegHit: { digits: string; callLog10: string | null; name: string | null } | null = null;
  forEachLegDepthFirst(r.legs, (leg) => {
    if (inboundLegHit) return;
    if (!String(leg.direction ?? "").toLowerCase().includes("inbound")) return;
    const hit = tryPartyPhone(leg.from);
    if (hit) inboundLegHit = hit;
  });
  if (inboundLegHit) return inboundLegHit;

  const dir = String(r.direction ?? "").toLowerCase();
  const inbound = dir.includes("inbound");
  const partyOrder = (inbound ? [r.from, r.to] : [r.to, r.from]).filter(
    (p): p is RcParty => p != null && typeof p === "object",
  );
  for (const p of partyOrder) {
    const hit = tryPartyPhone(p);
    if (hit) return hit;
  }
  {
    const stack = [...normalizeLegsArray(r.legs)];
    while (stack.length) {
      const leg = stack.pop()!;
      const order = inbound ? [leg.from, leg.to] : [leg.to, leg.from];
      for (const p of order) {
        const hit = tryPartyPhone(p);
        if (hit) return hit;
      }
      stack.push(...normalizeLegsArray(leg.legs));
    }
  }
  {
    const stack = [...normalizeLegsArray(r.legs)];
    while (stack.length) {
      const leg = stack.pop()!;
      for (const p of [leg.from, leg.to]) {
        const hit = tryPartyPhone(p);
        if (hit) return hit;
      }
      stack.push(...normalizeLegsArray(leg.legs));
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

/** Primary row may omit the PSTN party; same-session siblings often carry the customer number. */
function pickCustomerPhoneForImportWithContext(
  rec: RcCallRecord,
  contextRecords: RcCallRecord[] | undefined,
): ReturnType<typeof pickCustomerPhoneForImport> {
  const direct = pickCustomerPhoneForImport(rec);
  if (direct.digits.length >= MIN_DIGITS_LOOKUP) return direct;
  for (const r of contextRecords ?? []) {
    const hit = pickCustomerPhoneForImport(r);
    if (hit.digits.length >= MIN_DIGITS_LOOKUP) return hit;
  }
  return direct;
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

function numDurationField(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.min(Math.round(v), 86400);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Math.min(parseInt(v.trim(), 10), 86400);
  return 0;
}

/** Longest `duration` on the row or any nested `legs` (TELUS / FindMe splits put talk time on child legs). */
function maxDurationSecondsFromRcRecordTree(rec: RcCallRecord): number {
  const o = rec as unknown as Record<string, unknown>;
  let max = numDurationField(o.duration);
  const walk = (legs: unknown) => {
    for (const leg of normalizeLegsArray(legs as RcLeg[] | RcLeg | undefined)) {
      const L = leg as unknown as Record<string, unknown>;
      max = Math.max(max, numDurationField(L.duration));
      walk(L.legs);
    }
  };
  walk(o.legs);
  return max;
}

function maxDurationSecondsAcrossRcRecords(records: RcCallRecord[]): number {
  let m = 0;
  for (const r of records) m = Math.max(m, maxDurationSecondsFromRcRecordTree(r));
  return m;
}

function topLevelResultRaw(rec: RcCallRecord): string {
  return String((rec as unknown as Record<string, unknown>).result ?? "").trim();
}

function topLevelActionRaw(rec: RcCallRecord): string {
  return String((rec as unknown as Record<string, unknown>).action ?? "").trim();
}

/**
 * Prefer rows that carry the real customer conversation + recording (VoIP / connected), and demote
 * trailing FindMe / "Stopped" legs (often ~5s, no recording) that TELUS still emits as separate call-log ids.
 */
function recordingSourceRowScore(
  row: RcCallRecord,
  customerDigits: string,
  sessionHasSubstantiveLeg: boolean,
): number {
  const dur = maxDurationSecondsFromRcRecordTree(row);
  let s = dur;
  const resRaw = topLevelResultRaw(row);
  const res = resRaw.toLowerCase().replace(/_/g, " ");
  if (customerDigits.length >= MIN_DIGITS_LOOKUP && recordHasInboundCustomerOnFrom(row, customerDigits)) {
    s += 50_000;
  }
  if (ringCentralResultLooksAnsweredConnectedRaw(resRaw)) {
    s += 25_000;
  }
  if (/\bcall completed\b/.test(res)) {
    s += 8_000;
  }
  const action = topLevelActionRaw(row).toLowerCase();
  if (action.includes("voip")) {
    s += 12_000;
  }
  const stoppedish =
    res.includes("stopped") || res.includes("canceled") || res.includes("cancelled");
  if (stoppedish && dur <= 12 && sessionHasSubstantiveLeg) {
    s -= 60_000;
  }
  if (res.includes("missed") && dur <= 5 && sessionHasSubstantiveLeg) {
    s -= 40_000;
  }
  return s;
}

/**
 * Re-order merged recording refs so the **primary** segment (VoIP / long connected) wins over short tails.
 * Refs that only appear in `extras` (extension map) keep a neutral score and sort after high-scoring rows.
 */
function orderRecordingRefsBySessionRowPreference(
  customerDigits: string,
  sessionRows: RcCallRecord[],
  mergedRefs: RecordingRef[],
): RecordingRef[] {
  const uniqRows = dedupeRcRecordsById(sessionRows);
  const sessionHasSubstantiveLeg = uniqRows.some((r) => maxDurationSecondsFromRcRecordTree(r) >= 25);

  const rowScores = uniqRows.map((row) => ({
    row,
    score: recordingSourceRowScore(row, customerDigits, sessionHasSubstantiveLeg),
  }));
  rowScores.sort((a, b) => b.score - a.score);

  const out: RecordingRef[] = [];
  const seen = new Set<string>();
  for (const { row } of rowScores) {
    for (const ref of extractAllRecordingsFromRcRecord(row)) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      out.push(ref);
    }
  }
  for (const ref of mergedRefs) {
    if (!seen.has(ref.id)) {
      seen.add(ref.id);
      out.push(ref);
    }
  }
  return out;
}

/** Earliest `startTime` across session fragments (internal legs start after the PSTN inbound row). */
function earliestStartTimeAmongRecords(records: RcCallRecord[]): Date | null {
  let best: number | null = null;
  for (const r of records) {
    const t = r.startTime ? new Date(r.startTime).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    if (best == null || t < best) best = t;
  }
  return best != null ? new Date(best) : null;
}

function toImportedCall(
  rec: RcCallRecord,
  extraRecordings?: RecordingRef[],
  opts?: { directionContextRecords?: RcCallRecord[]; directionFallback?: CallDirection },
): RingCentralImportedCall | null {
  const id = String(rec.id ?? "").trim();
  if (!id) return null;
  const type = String(rec.type ?? "").toLowerCase();
  if (isExcludedNonVoiceCallType(type)) return null;
  /* List requests already use `type=Voice`; do not drop rows on unknown `type` strings (TELUS / RC variants). */

  const phone = pickCustomerPhoneForImportWithContext(rec, opts?.directionContextRecords);
  const contextDeduped = dedupeRcRecordsById(opts?.directionContextRecords ?? []);
  const sessionRows = dedupeRcRecordsById([rec, ...contextDeduped]);
  const inferredDir = resolveRingCentralCustomerDirection(rec, phone.digits, contextDeduped);
  const sessionChronologyDir = resolveSessionDirectionByChronology(sessionRows);
  const direction = inferredDir ?? sessionChronologyDir ?? opts?.directionFallback ?? mapDirection(rec.direction) ?? null;
  if (!direction) return null;

  const start = rec.startTime ? new Date(rec.startTime) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  const sessionEarliest = earliestStartTimeAmongRecords(sessionRows);
  const happenedAt =
    contextDeduped.length > 0 &&
    sessionEarliest &&
    !Number.isNaN(sessionEarliest.getTime()) &&
    sessionEarliest.getTime() < start.getTime()
      ? sessionEarliest
      : start;

  // Prefer extras (siblings, extension map, account Detail fetch) over list-row extractions so FindMe/transfer legs
  // with the real recording win when the parent row carries a stale or empty ref (common on TELUS-style logs).
  const merged = mergeRecordingRefsInOrder(extraRecordings, extractAllRecordingsFromRcRecord(rec));
  const mergedOrdered = orderRecordingRefsBySessionRowPreference(phone.digits, sessionRows, merged);
  const primary = mergedOrdered[0];
  const metaRaw = rec as unknown as Record<string, unknown>;
  const longConv = sessionRows.some((r) => maxDurationSecondsFromRcRecordTree(r) >= 25);
  const peerRows = contextDeduped
    .slice()
    .sort(
      (a, b) =>
        recordingSourceRowScore(b, phone.digits, longConv) - recordingSourceRowScore(a, phone.digits, longConv),
    );
  const peerMetas = peerRows.map((r) => r as unknown as Record<string, unknown>);
  const disp = dispositionFromRingCentralRecordWithSessionContext(metaRaw, direction, peerMetas);

  const metaOut: Record<string, unknown> = { ...metaRaw };
  const sessionKeyHints = collectSessionHintsFromRcRecords(...sessionRows);
  if (sessionKeyHints.length > 0) {
    metaOut.sessionKeyHints = sessionKeyHints;
  }
  const durationAcrossSession = maxDurationSecondsAcrossRcRecords(sessionRows);
  if (durationAcrossSession > 0) {
    const existingTop = numDurationField(metaOut.duration);
    if (durationAcrossSession > existingTop) {
      metaOut.duration = durationAcrossSession;
    }
  }

  return {
    ringCentralCallLogId: id,
    direction,
    happenedAt,
    phoneNormalized: phone.digits,
    contactPhone10: phone.callLog10,
    contactName: sanitizeTelephonyContactName(phone.name),
    recording: primary,
    recordings: mergedOrdered.length > 0 ? mergedOrdered : undefined,
    metadata: metaOut,
    telephonyResult: disp.resultLabel,
    telephonyCallbackPending: disp.callbackPending,
    telephonyAnsweredConnected: disp.answeredConnected,
  };
}

type RcPlatform = Awaited<ReturnType<typeof getRingCentralPlatform>>;

/** RingCentral rejects tight bursts of REST calls with "Request rate exceeded" — pace sync traffic. */
const RC_SYNC_MIN_REQUEST_INTERVAL_MS = 350;

let rcSyncLastRequestEndedAt = 0;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function paceRingCentralSyncRequest(): Promise<void> {
  const now = Date.now();
  const wait = rcSyncLastRequestEndedAt + RC_SYNC_MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await sleepMs(wait);
}

function touchRingCentralSyncRequestEnd(): void {
  rcSyncLastRequestEndedAt = Date.now();
}

/**
 * `@ringcentral/sdk` throws on non-2xx instead of returning `Response`.
 * Unwrap so callers can treat 404/403 like `!resp.ok` (e.g. extension call-log id ≠ account id).
 */
function ringCentralSdkErrorResponse(e: unknown): Response | null {
  if (!e || typeof e !== "object") return null;
  const r = (e as { response?: unknown }).response;
  if (r && typeof r === "object" && "status" in r && typeof (r as Response).status === "number") {
    return r as Response;
  }
  return null;
}

/**
 * Throttled GET for call-log sync. Retries with backoff on HTTP 429 (per-minute / burst limits).
 */
async function rcSyncGet(platform: RcPlatform, url: string, query?: unknown): Promise<Response> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await paceRingCentralSyncRequest();
    let resp: Response;
    try {
      resp = query !== undefined ? await platform.get(url, query) : await platform.get(url);
    } catch (e) {
      const r = ringCentralSdkErrorResponse(e);
      if (!r) throw e;
      resp = r;
    }
    touchRingCentralSyncRequestEnd();

    if (resp.status !== 429 || attempt === maxAttempts - 1) {
      return resp;
    }

    let waitMs = 1800 * (attempt + 1);
    const ra = resp.headers.get("retry-after");
    if (ra) {
      const sec = parseInt(ra, 10);
      if (Number.isFinite(sec) && sec > 0) {
        waitMs = Math.min(sec * 1000, 60_000);
      }
    }
    await sleepMs(waitMs);
  }
  throw new Error("rcSyncGet: exhausted retries without returning (bug).");
}

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
    const resp = await rcSyncGet(platform, "/restapi/v1.0/account/~/extension/~/call-log", {
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
    let body: RcCallLogListResponse;
    try {
      body = (await resp.json()) as RcCallLogListResponse;
    } catch {
      errors.push(`Extension call-log page ${page}: response was not valid JSON`);
      break;
    }
    const records = body.records ?? [];
    for (const rec of records) {
      const all = extractAllRecordingsFromRcRecord(rec);
      if (!all.length) continue;
      const cid = String(rec.id ?? "").trim();
      const sid = String(rec.sessionId ?? "").trim();
      const tsid = String(rec.telephonySessionId ?? "").trim();
      if (cid) mergeRecordingMapEntry(byCallLogId, cid, all);
      if (sid) mergeRecordingMapEntry(bySessionId, sid, all);
      if (tsid) mergeRecordingMapEntry(bySessionId, tsid, all);
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
  const tsid = String(rec.telephonySessionId ?? "").trim();
  return mergeRecordingRefsInOrder(
    cid ? byCallLogId.get(cid) : undefined,
    sid ? bySessionId.get(sid) : undefined,
    tsid ? bySessionId.get(tsid) : undefined,
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
  const resp = await rcSyncGet(platform, path, { view: "Detailed" });
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

  /** Hint string → full session graph from {@link expandRcSessionRecordGraph} (dedupes repeat work across rows). */
  const sessionGraphByAnyHint = new Map<string, RcCallRecord[]>();

  let page = 1;
  const perPage = 250;

  for (;;) {
    const resp = await rcSyncGet(platform, "/restapi/v1.0/account/~/call-log", {
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

    type RowWork = {
      rec: RcCallRecord;
      extra: RecordingRef[];
      cid: string;
      needAccountDetail: boolean;
      sessionMates: RcCallRecord[];
    };
    const rowWorks: RowWork[] = [];

    for (const rec of records) {
      const sessionMates = records.filter((r) => r !== rec && sameTelephonySession(rec, r));
      const fromSiblingsOnPage = mergeRecordingRefsInOrder(
        ...sessionMates.map((r) => extractAllRecordingsFromRcRecord(r)),
      );
      const cid = String(rec.id ?? "").trim();
      const extra = mergeRecordingRefsInOrder(
        fromSiblingsOnPage,
        extensionRecordingExtrasForCall(rec, byCallLogId, bySessionId),
      );
      const haveAnyRecording = mergeRecordingRefsInOrder(extractAllRecordingsFromRcRecord(rec), extra).length > 0;
      rowWorks.push({
        rec,
        extra,
        cid,
        needAccountDetail: !haveAnyRecording && Boolean(cid),
        sessionMates,
      });
    }

    const batchIds = rowWorks.filter((w) => w.needAccountDetail).map((w) => w.cid);
    const detailById = await fetchAccountCallLogDetailsBatch(platform, batchIds);

    for (const w of rowWorks) {
      let extra = w.extra;
      let detailRow: RcCallRecord | null = null;
      const directionContext = [...w.sessionMates];
      if (w.needAccountDetail && w.cid) {
        detailRow = detailById.get(w.cid) ?? null;
        const refs = detailRow
          ? extractAllRecordingsFromRcRecord(detailRow)
          : await recordingRefsFromAccountCallLogDetail(platform, w.cid);
        extra = mergeRecordingRefsInOrder(refs, extra);
      }
      const hints = w.cid ? collectSessionHintsFromRcRecords(w.rec, detailRow) : [];

      /**
       * BFS session graph (same as telephony webhook import): 101→102 / FindMe / park legs often use different
       * `sessionId` vs `telephonySessionId` values — paging only the primary row’s hints misses linked rows.
       */
      if (hints.length > 0 && w.cid) {
        let expanded: RcCallRecord[] | undefined;
        for (const h of hints) {
          expanded = sessionGraphByAnyHint.get(h);
          if (expanded) break;
        }
        if (!expanded) {
          const seeds = dedupeRcRecordsById([
            w.rec,
            ...w.sessionMates,
            ...(detailRow ? [detailRow] : []),
          ]);
          expanded = await expandRcSessionRecordGraph(
            platform,
            seeds,
            dateFrom,
            dateTo,
            RC_BULK_SESSION_LOOKUP_MAX_PAGES,
          );
          for (const r of expanded) {
            for (const hint of collectSessionHintsFromRcRecords(r)) {
              if (!sessionGraphByAnyHint.has(hint)) sessionGraphByAnyHint.set(hint, expanded);
            }
          }
        }
        const expandedOthers = expanded.filter((r) => String(r.id ?? "").trim() !== w.cid);
        directionContext.push(...expandedOthers);
        extra = mergeRecordingRefsInOrder(extra, ...expandedOthers.map((r) => extractAllRecordingsFromRcRecord(r)));
      }
      const imported = toImportedCall(w.rec, extra, {
        directionContextRecords: dedupeRcRecordsById(directionContext),
      });
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

/**
 * Same voice session when any session identifier matches (101→102 splits often put `sessionId` on one row and
 * `telephonySessionId` on another, or only one field is populated per leg).
 */
function sameTelephonySession(a: RcCallRecord, b: RcCallRecord): boolean {
  const idsA = [
    ...new Set(
      [String(a.telephonySessionId ?? "").trim(), String(a.sessionId ?? "").trim()].filter(Boolean),
    ),
  ];
  const idsB = [
    ...new Set(
      [String(b.telephonySessionId ?? "").trim(), String(b.sessionId ?? "").trim()].filter(Boolean),
    ),
  ];
  for (const x of idsA) {
    for (const y of idsB) {
      if (x === y) return true;
    }
  }
  return false;
}

const TELEPHONY_END_IMPORT_HOURS_BACK = 8;
/** Account-level voice volume can exceed a few pages; session-end import must still find the row we just hung up. */
const TELEPHONY_END_IMPORT_MAX_PAGES = 40;

/**
 * Re-fetch the CRM call log from RingCentral at these offsets after telephony session-end import.
 * Recording metadata often appears well after the call row exists; the first import may show "completed"
 * with no `contentUri` even when a recording will exist.
 */
export const TELEPHONY_RECORDING_REFRESH_DELAY_SEQUENCE_MS = [
  12_000, 28_000, 72_000, 130_000, 240_000,
] as const;

export function buildTelephonyRecordingRefreshJobs(
  callLogId: string,
): Array<{ callLogId: string; delayMs: number }> {
  const id = callLogId.trim();
  if (!id) return [];
  return TELEPHONY_RECORDING_REFRESH_DELAY_SEQUENCE_MS.map((delayMs) => ({ callLogId: id, delayMs }));
}

/**
 * Pages account call-log until `sessionId` matches (or pages exhaust). Used for webhook-time import and per-call refresh.
 */
async function loadAccountCallLogRecordsMatchingTelephonySessionInWindow(
  platform: RcPlatform,
  sessionId: string,
  dateFrom: Date,
  dateTo: Date,
  directionFilter: string | undefined,
  maxPages: number,
): Promise<RcCallRecord[]> {
  const want = sessionId.trim();
  if (!want) return [];
  const matchedById = new Map<string, RcCallRecord>();

  for (let page = 1; page <= maxPages; page++) {
    const query: Record<string, string | number> = {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      page,
      perPage: 100,
      type: "Voice",
      view: "Detailed",
    };
    if (directionFilter) query.direction = directionFilter;

    const resp = await rcSyncGet(platform, "/restapi/v1.0/account/~/call-log", query);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(
        `[rc-call-log-session] lookup HTTP ${resp.status} for session ${want.slice(0, 24)}… ${text.slice(0, 200)}`,
      );
      break;
    }

    let body: RcCallLogListResponse;
    try {
      body = (await resp.json()) as RcCallLogListResponse;
    } catch {
      console.warn(`[rc-call-log-session] page ${page}: invalid JSON for session ${want.slice(0, 24)}…`);
      break;
    }
    const records = body.records ?? [];

    for (const rec of records) {
      if (recordMatchesTelephonySession(rec, want)) {
        const rid = String(rec.id ?? "").trim();
        if (rid) matchedById.set(rid, rec);
      }
    }

    const totalPages = body.paging?.totalPages;
    const lastPage =
      records.length === 0 ||
      (typeof totalPages === "number" && page >= totalPages) ||
      records.length < 100;
    if (lastPage) break;
  }

  return [...matchedById.values()].sort((a, b) => {
    const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
    const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
    return ta - tb;
  });
}

/**
 * Call forwarding / multi-extension splits sometimes put `sessionId` vs `telephonySessionId` on different account
 * call-log rows (e.g. 101 staging vs 202 answer). BFS on session hints merges the graph so peer disposition works.
 */
const RC_SESSION_GRAPH_EXPAND_MAX_HINTS = 36;
const RC_SESSION_GRAPH_EXPAND_MAX_IDS = 80;

async function expandRcSessionRecordGraph(
  platform: RcPlatform,
  seedRecords: RcCallRecord[],
  dateFrom: Date,
  dateTo: Date,
  maxPages: number,
): Promise<RcCallRecord[]> {
  const byId = new Map<string, RcCallRecord>();
  for (const r of seedRecords) {
    const id = String(r.id ?? "").trim();
    if (id) byId.set(id, r);
  }
  const seenHints = new Set<string>();
  const hintQueue: string[] = [];
  for (const r of seedRecords) {
    for (const h of collectSessionHintsFromRcRecords(r)) {
      if (!seenHints.has(h)) {
        seenHints.add(h);
        hintQueue.push(h);
      }
    }
  }
  let processed = 0;
  while (
    hintQueue.length > 0 &&
    processed < RC_SESSION_GRAPH_EXPAND_MAX_HINTS &&
    byId.size < RC_SESSION_GRAPH_EXPAND_MAX_IDS
  ) {
    const h = hintQueue.shift()!;
    processed += 1;
    const rows = await loadAccountCallLogRecordsMatchingTelephonySessionInWindow(
      platform,
      h,
      dateFrom,
      dateTo,
      undefined,
      maxPages,
    );
    for (const r of rows) {
      const id = String(r.id ?? "").trim();
      if (!id) continue;
      if (!byId.has(id)) {
        byId.set(id, r);
        for (const nh of collectSessionHintsFromRcRecords(r)) {
          if (!seenHints.has(nh)) {
            seenHints.add(nh);
            hintQueue.push(nh);
          }
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => {
    const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
    const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
    return ta - tb;
  });
}

/** Numeric `sessionId` and `telephonySessionId` (`s-…`) can both appear; union lookups so sibling rows are not missed. */
function collectSessionHintsFromRcRecords(...parts: (RcCallRecord | null | undefined)[]): string[] {
  const hints = new Set<string>();
  for (const rec of parts) {
    if (!rec) continue;
    const a = String(rec.telephonySessionId ?? "").trim();
    const b = String(rec.sessionId ?? "").trim();
    if (a) hints.add(a);
    if (b) hints.add(b);
  }
  return [...hints];
}

function collectSessionHintsFromStoredMetadata(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const o = meta as Record<string, unknown>;
  const hints = new Set<string>();
  for (const key of ["telephonySessionId", "sessionId"] as const) {
    const s = String(o[key] ?? "").trim();
    if (s) hints.add(s);
  }
  const extra = o.sessionKeyHints;
  if (Array.isArray(extra)) {
    for (const item of extra) {
      const s = String(item ?? "").trim();
      if (s) hints.add(s);
    }
  }
  return [...hints];
}

async function loadSiblingRcRecordsForSessionHints(
  platform: RcPlatform,
  hints: string[],
  dateFrom: Date,
  dateTo: Date,
  excludeCallLogId: string,
  maxPages: number,
): Promise<RcCallRecord[]> {
  const exclude = excludeCallLogId.trim();
  const byId = new Map<string, RcCallRecord>();
  for (const h of hints) {
    const trimmed = h.trim();
    if (!trimmed) continue;
    const rows = await loadAccountCallLogRecordsMatchingTelephonySessionInWindow(
      platform,
      trimmed,
      dateFrom,
      dateTo,
      undefined,
      maxPages,
    );
    for (const r of rows) {
      const rid = String(r.id ?? "").trim();
      if (!rid || rid === exclude) continue;
      byId.set(rid, r);
    }
  }
  return [...byId.values()];
}

/** Full sync: session graph paging (shared with telephony BFS expand). */
const RC_BULK_SESSION_LOOKUP_MAX_PAGES = 24;

async function tryFetchCallLogRecordDetailed(platform: RcPlatform, callLogId: string): Promise<RcCallRecord | null> {
  const id = callLogId.trim();
  if (!id) return null;
  const paths = [
    `/restapi/v1.0/account/~/call-log/${encodeURIComponent(id)}`,
    `/restapi/v1.0/account/~/extension/~/call-log/${encodeURIComponent(id)}`,
  ];
  for (const path of paths) {
    const resp = await rcSyncGet(platform, path, { view: "Detailed" });
    if (!resp.ok) continue;
    try {
      return (await resp.json()) as RcCallRecord;
    } catch {
      /* try next path */
    }
  }
  return null;
}

type RcBatchCallLogPart = {
  resourceId?: string | number;
  status?: number;
  body?: unknown;
};

/**
 * RingCentral supports batch GET for homogeneous call-log records: comma-separated ids in the path.
 * Response is often HTTP 207 with `application/vnd.ringcentral.multipart+json` (array of per-id status + body).
 */
async function fetchAccountCallLogDetailsBatch(
  platform: RcPlatform,
  ids: string[],
): Promise<Map<string, RcCallRecord>> {
  const out = new Map<string, RcCallRecord>();
  const clean = [...new Set(ids.map((i) => String(i).trim()).filter(Boolean))];
  if (clean.length === 0) return out;

  const chunkSize = 10;
  for (let i = 0; i < clean.length; i += chunkSize) {
    const chunk = clean.slice(i, i + chunkSize);
    const path = `/restapi/v1.0/account/~/call-log/${chunk.map(encodeURIComponent).join(",")}`;
    try {
      const resp = await rcSyncGet(platform, path, { view: "Detailed" });

      if (resp.status === 207) {
        let parsed: unknown;
        try {
          parsed = await resp.json();
        } catch {
          continue;
        }
        if (Array.isArray(parsed)) {
          for (const p of parsed as RcBatchCallLogPart[]) {
            if (p.status !== 200 || !p.body || typeof p.body !== "object") continue;
            const body = p.body as RcCallRecord;
            let rid = String(p.resourceId ?? "").trim();
            if (!rid) rid = String(body.id ?? "").trim();
            if (rid) out.set(rid, body);
          }
        }
        continue;
      }

      if (resp.ok && resp.status === 200) {
        try {
          const one = (await resp.json()) as RcCallRecord;
          const id = String(one?.id ?? "").trim();
          if (id) out.set(id, one);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* caller falls back per id */
    }
  }
  return out;
}

async function findAccountCallLogRecordByIdInWindow(
  platform: RcPlatform,
  rcCallLogId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<RcCallRecord | null> {
  const want = rcCallLogId.trim();
  if (!want) return null;
  const perPage = 250;
  const maxPages = 25;

  for (let page = 1; page <= maxPages; page++) {
    const resp = await rcSyncGet(platform, "/restapi/v1.0/account/~/call-log", {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      page,
      perPage,
      type: "Voice",
      view: "Detailed",
    });
    if (!resp.ok) break;
    let body: RcCallLogListResponse;
    try {
      body = (await resp.json()) as RcCallLogListResponse;
    } catch {
      break;
    }
    const records = body.records ?? [];
    for (const rec of records) {
      if (String(rec.id ?? "").trim() === want) return rec;
    }
    const totalPages = body.paging?.totalPages;
    const lastPage =
      records.length === 0 ||
      (typeof totalPages === "number" && page >= totalPages) ||
      records.length < perPage;
    if (lastPage) break;
  }
  return null;
}

/** Account `call-log/{id}?view=Detailed` often includes full nested legs + recordings missing from list rows (TELUS / FindMe). */
async function recordingRefsFromAccountCallLogDetail(platform: RcPlatform, callLogId: string): Promise<RecordingRef[]> {
  const id = callLogId.trim();
  if (!id) return [];
  const detail = await tryFetchCallLogRecordDetailed(platform, id);
  return detail ? extractAllRecordingsFromRcRecord(detail) : [];
}

export type SyncSingleRingCentralCallLogResult =
  | { ok: true }
  | { ok: false; error: string };

/** Re-fetch one CRM call log from RingCentral by stored `ringCentralCallLogId` (real id or `webhook-ts:…` session). */
export async function syncSingleRingCentralCallLogByCrmId(crmCallLogId: string): Promise<SyncSingleRingCentralCallLogResult> {
  try {
    return await syncSingleRingCentralCallLogByCrmIdInner(crmCallLogId);
  } catch (e) {
    console.error("[sync-single-call-log]", crmCallLogId, e);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.trim() || "RingCentral sync failed unexpectedly." };
  }
}

async function syncSingleRingCentralCallLogByCrmIdInner(
  crmCallLogId: string,
): Promise<SyncSingleRingCentralCallLogResult> {
  const env = getRingCentralEnv();
  if (!env) {
    return { ok: false, error: "RingCentral is not configured." };
  }

  const sb = getSupabaseAdmin();
  const { data: callRow, error: rowErr } = await sb
    .from(tables.CallLog)
    .select("id,ringCentralCallLogId,happenedAt,telephonyMetadata")
    .eq("id", crmCallLogId)
    .maybeSingle();
  if (rowErr) {
    return { ok: false, error: rowErr.message };
  }
  if (!callRow) {
    return { ok: false, error: "Call log not found." };
  }

  const rcKey = String((callRow as { ringCentralCallLogId?: string | null }).ringCentralCallLogId ?? "").trim();
  if (!rcKey) {
    return { ok: false, error: "This call is not linked to RingCentral (no RingCentral id on file)." };
  }

  const happenedAt = new Date(String((callRow as { happenedAt: string }).happenedAt));
  if (Number.isNaN(happenedAt.getTime())) {
    return { ok: false, error: "Invalid call timestamp." };
  }

  const now = new Date();
  let windowStart = subHours(happenedAt, 72);
  let windowEnd = addHours(happenedAt, 72);
  if (windowEnd > now) windowEnd = now;
  if (windowStart > windowEnd) windowStart = subHours(windowEnd, 1);

  const platform = await getRingCentralPlatform();
  const extErrors: string[] = [];
  const { byCallLogId, bySessionId } = await loadExtensionRecordingMaps(platform, windowStart, windowEnd, extErrors);
  for (const msg of extErrors) {
    console.warn(`[sync-single-call-log] extension call-log map: ${msg}`);
  }

  const buildImportedFromSessionRows = async (matchedList: RcCallRecord[], orderStubDigitsNorm: string) => {
    if (matchedList.length === 0) return null;
    const ordered = orderMatchedListForTelephonyImport(matchedList, orderStubDigitsNorm);
    const primary = ordered[0]!;
    const pid = String(primary.id ?? "").trim();
    /** Every other session row — not `ordered.slice(1)` — so direction/recording context matches the full graph. */
    const directionPeers = matchedList.filter((r) => String(r.id ?? "").trim() !== pid);
    const fromSiblingRows = mergeRecordingRefsInOrder(
      ...directionPeers.map((r) => extractAllRecordingsFromRcRecord(r)),
    );
    const fromExt = mergeRecordingRefsInOrder(
      ...matchedList.map((r) => extensionRecordingExtrasForCall(r, byCallLogId, bySessionId)),
    );
    const cid = String(primary.id ?? "").trim();
    const fromDetail = cid ? await tryFetchExtensionCallLogDetailRecordings(platform, cid) : [];
    const accountPrimaryDetail = cid ? await tryFetchCallLogRecordDetailed(platform, cid) : null;
    const fromAccountDetail = accountPrimaryDetail ? extractAllRecordingsFromRcRecord(accountPrimaryDetail) : [];
    return toImportedCall(
      primary,
      mergeRecordingRefsInOrder(fromAccountDetail, fromSiblingRows, fromExt, fromDetail),
      { directionContextRecords: directionPeers },
    );
  };

  if (rcKey.startsWith(WEBHOOK_TELEPHONY_LOG_ID_PREFIX)) {
    const sessionId = rcKey.slice(WEBHOOK_TELEPHONY_LOG_ID_PREFIX.length).trim();
    if (!sessionId) {
      return { ok: false, error: "Invalid RingCentral session placeholder on this call." };
    }
    let matchedList = await loadAccountCallLogRecordsMatchingTelephonySessionInWindow(
      platform,
      sessionId,
      windowStart,
      windowEnd,
      undefined,
      TELEPHONY_END_IMPORT_MAX_PAGES,
    );
    matchedList = await expandRcSessionRecordGraph(
      platform,
      matchedList,
      windowStart,
      windowEnd,
      TELEPHONY_END_IMPORT_MAX_PAGES,
    );
    const imported = await buildImportedFromSessionRows(matchedList, "");
    if (!imported) {
      return {
        ok: false,
        error:
          "RingCentral has no call-log row for this session in the search window yet. Try again later or run Workspace → Sync call logs.",
      };
    }
    try {
      await applyRingCentralImportToExistingCallLogById(crmCallLogId, imported);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const accountDetailRec = await tryFetchCallLogRecordDetailed(platform, rcKey);
  let rec = accountDetailRec;
  if (!rec || String(rec.id ?? "").trim() !== rcKey) {
    rec = await findAccountCallLogRecordByIdInWindow(platform, rcKey, windowStart, windowEnd);
  }
  if (!rec || String(rec.id ?? "").trim() !== rcKey) {
    return {
      ok: false,
      error:
        "This call was not found in RingCentral (check retention, or the id may no longer match). Try a full sync with a wider date range.",
    };
  }

  const fromDetail = await tryFetchExtensionCallLogDetailRecordings(platform, rcKey);
  const accountRecForRefs =
    accountDetailRec && String(accountDetailRec.id ?? "").trim() === rcKey
      ? accountDetailRec
      : rec && String(rec.id ?? "").trim() === rcKey
        ? rec
        : await tryFetchCallLogRecordDetailed(platform, rcKey);
  const fromAccountDetail = extractAllRecordingsFromRcRecord((accountRecForRefs ?? {}) as RcCallRecord);
  const extras = mergeRecordingRefsInOrder(
    fromAccountDetail,
    extensionRecordingExtrasForCall(rec, byCallLogId, bySessionId),
    fromDetail,
  );

  const storedMeta = (callRow as { telephonyMetadata?: unknown }).telephonyMetadata;
  const sessionHints = [
    ...new Set([
      ...collectSessionHintsFromRcRecords(rec, accountRecForRefs),
      ...collectSessionHintsFromStoredMetadata(storedMeta),
    ]),
  ];
  const flatSiblings = await loadSiblingRcRecordsForSessionHints(
    platform,
    sessionHints,
    windowStart,
    windowEnd,
    rcKey,
    TELEPHONY_END_IMPORT_MAX_PAGES,
  );
  const expanded = await expandRcSessionRecordGraph(
    platform,
    dedupeRcRecordsById([rec, ...flatSiblings]),
    windowStart,
    windowEnd,
    TELEPHONY_END_IMPORT_MAX_PAGES,
  );
  const sessionOthers = expanded.filter((r) => String(r.id ?? "").trim() !== rcKey);
  const siblingRefs = mergeRecordingRefsInOrder(
    ...sessionOthers.map((r) => extractAllRecordingsFromRcRecord(r)),
  );

  const imported = toImportedCall(rec, mergeRecordingRefsInOrder(siblingRefs, extras), {
    directionContextRecords: sessionOthers,
  });
  if (!imported) {
    return { ok: false, error: "Could not build RingCentral import for this call." };
  }
  try {
    await applyRingCentralImportToExistingCallLogById(crmCallLogId, imported);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function scoreRcRowForTelephonyPrimary(r: RcCallRecord, stubDigitsNorm: string): number {
  let s = 0;
  if (extractAllRecordingsFromRcRecord(r).length > 0) s += 100;
  const d = String(r.direction ?? "").toLowerCase();
  if (d.includes("inbound")) s += 50;
  const phone = pickCustomerPhoneForImport(r);
  if (stubDigitsNorm.length >= MIN_DIGITS_LOOKUP && phone.digits === stubDigitsNorm) s += 40;
  return s;
}

/** Oldest-first API order often surfaces an internal leg first; prefer inbound / recording / caller match as primary. */
function orderMatchedListForTelephonyImport(matchedList: RcCallRecord[], stubDigitsNorm: string): RcCallRecord[] {
  return [...matchedList].sort(
    (a, b) => scoreRcRowForTelephonyPrimary(b, stubDigitsNorm) - scoreRcRowForTelephonyPrimary(a, stubDigitsNorm),
  );
}

async function tryImportRingCentralSessionRowsForStub(
  platform: RcPlatform,
  matchedList: RcCallRecord[],
  stub: TelephonyWebhookSessionStubInput,
  integrationUserId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<{ imported: RingCentralImportedCall; callLogId: string } | null> {
  if (!matchedList.length) return null;
  matchedList = await expandRcSessionRecordGraph(
    platform,
    matchedList,
    dateFrom,
    dateTo,
    TELEPHONY_END_IMPORT_MAX_PAGES,
  );
  const extErrors: string[] = [];
  const { byCallLogId, bySessionId } = await loadExtensionRecordingMaps(platform, dateFrom, dateTo, extErrors);
  for (const msg of extErrors) {
    console.warn(`[telephony-session-import] extension call-log map: ${msg}`);
  }
  const stubDigits = stub.phoneNormalized.replace(/\D/g, "");
  const ordered = orderMatchedListForTelephonyImport(matchedList, stubDigits);

  for (const primary of ordered) {
    const pid = String(primary.id ?? "").trim();
    if (!pid) continue;
    const siblings = matchedList.filter((r) => String(r.id ?? "").trim() !== pid);
    const fromSiblingRows = mergeRecordingRefsInOrder(...siblings.map((r) => extractAllRecordingsFromRcRecord(r)));
    const fromExt = mergeRecordingRefsInOrder(
      ...matchedList.map((r) => extensionRecordingExtrasForCall(r, byCallLogId, bySessionId)),
    );
    const fromDetail = await tryFetchExtensionCallLogDetailRecordings(platform, pid);
    const accountPrimaryDetail = await tryFetchCallLogRecordDetailed(platform, pid);
    const fromAccountDetail = accountPrimaryDetail ? extractAllRecordingsFromRcRecord(accountPrimaryDetail) : [];
    const imported = toImportedCall(
      primary,
      mergeRecordingRefsInOrder(fromAccountDetail, fromSiblingRows, fromExt, fromDetail),
      { directionContextRecords: siblings, directionFallback: stub.direction },
    );
    if (!imported) continue;
    await deleteCallLogWebhookTelephonyPlaceholder(stub.telephonySessionId);
    const { callLogId } = await upsertCallLogFromRingCentralImport(imported, integrationUserId);
    return { imported, callLogId };
  }
  return null;
}

export type TelephonySessionEndImportOutcome = {
  callLogId: string;
  /** True when no recording URI yet — RingCentral often attaches this seconds–minutes after hangup. */
  missingRecording: boolean;
};

/**
 * When a telephony session ends (webhook), try to import the matching account call-log row immediately.
 * If RingCentral has not published it yet, writes a `webhook-ts:{session}` placeholder (same path as full sync).
 */
export async function importCallLogForTelephonySessionEnd(
  stub: TelephonyWebhookSessionStubInput,
): Promise<TelephonySessionEndImportOutcome | null> {
  const env = getRingCentralEnv();
  if (!env) {
    return null;
  }

  const sessionId = stub.telephonySessionId.trim();
  if (!sessionId) {
    return null;
  }

  const platform = await getRingCentralPlatform();
  const dateTo = new Date();
  const dateFrom = subHours(dateTo, TELEPHONY_END_IMPORT_HOURS_BACK);

  /** Do not filter by direction: inbound sessions still emit outbound legs (FindMe, park) that carry recordings. */
  const matchedList = await loadAccountCallLogRecordsMatchingTelephonySessionInWindow(
    platform,
    sessionId,
    dateFrom,
    dateTo,
    undefined,
    TELEPHONY_END_IMPORT_MAX_PAGES,
  );

  const hit = await tryImportRingCentralSessionRowsForStub(
    platform,
    matchedList,
    stub,
    env.integrationUserId,
    dateFrom,
    dateTo,
  );
  if (hit) {
    const autoTx = getRingCentralAutoTranscribe();
    if (autoTx && hit.imported.recording?.contentUri) {
      try {
        if (await shouldStartAutoTranscriptionForCallLog(hit.callLogId)) {
          await startRingCentralSpeechToTextForCallLog(hit.callLogId);
        }
      } catch {
        /* non-fatal */
      }
    }
    return {
      callLogId: hit.callLogId,
      missingRecording: !Boolean(String(hit.imported.recording?.contentUri ?? "").trim()),
    };
  }

  const { callLogId } = await upsertCallLogFromTelephonyWebhookStub(stub, env.integrationUserId);
  return { callLogId, missingRecording: true };
}
