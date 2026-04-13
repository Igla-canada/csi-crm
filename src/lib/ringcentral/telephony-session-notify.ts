import "server-only";

import { randomUUID } from "crypto";

import { CallDirection } from "@/lib/db";
import {
  sanitizeTelephonyContactName,
  type TelephonyWebhookSessionStubInput,
} from "@/lib/crm";
import {
  pickCustomerPhoneFromRcFromTo,
  type RcPhoneEndpoint,
} from "@/lib/ringcentral/customer-phone-from-rc-parties";
import type { ExtensionActiveCallSummary } from "@/lib/ringcentral/fetch-extension-active-calls";
import { getTelephonySessionEndGraceMs } from "@/lib/ringcentral/env";
import { ringCentralResultLooksAnsweredConnectedRaw } from "@/lib/ringcentral/call-result";
import {
  buildTelephonyRecordingRefreshJobs,
  importCallLogForTelephonySessionEnd,
} from "@/lib/ringcentral/sync-call-logs";
import {
  deleteTelephonyLiveSession,
  getTelephonyLiveSessionRow,
  type TelephonyLiveSessionRow,
  upsertTelephonyLiveSession,
} from "@/lib/ringcentral/telephony-live-sessions";

const MIN_DIGITS_LOOKUP = 7;

/** Shown in the live dock / call history while import is deferred (grace window). */
const TELEPHONY_LIVE_STATUS_FINISHING = "Finishing call";

type PersistedWebhookStubJson = {
  telephonySessionId: string;
  direction: "INBOUND" | "OUTBOUND";
  phoneNormalized: string;
  contactPhone10: string | null;
  contactName: string;
  happenedAtIso: string;
  telephonyResult: string | null;
  telephonyCallbackPending: boolean;
  telephonyAnsweredConnected: boolean;
};

function stubToPersistedJson(stub: TelephonyWebhookSessionStubInput): string {
  const body: PersistedWebhookStubJson = {
    telephonySessionId: stub.telephonySessionId,
    direction: stub.direction === CallDirection.OUTBOUND ? "OUTBOUND" : "INBOUND",
    phoneNormalized: stub.phoneNormalized,
    contactPhone10: stub.contactPhone10,
    contactName: stub.contactName,
    happenedAtIso: stub.happenedAt.toISOString(),
    telephonyResult: stub.telephonyResult,
    telephonyCallbackPending: stub.telephonyCallbackPending,
    telephonyAnsweredConnected: stub.telephonyAnsweredConnected,
  };
  return JSON.stringify(body);
}

function persistedJsonToStub(json: string): TelephonyWebhookSessionStubInput | null {
  try {
    const p = JSON.parse(json) as PersistedWebhookStubJson;
    const sid = String(p.telephonySessionId ?? "").trim();
    if (!sid) return null;
    const d = new Date(p.happenedAtIso);
    if (Number.isNaN(d.getTime())) return null;
    return {
      telephonySessionId: sid,
      direction: p.direction === "OUTBOUND" ? CallDirection.OUTBOUND : CallDirection.INBOUND,
      phoneNormalized: String(p.phoneNormalized ?? ""),
      contactPhone10: p.contactPhone10 ?? null,
      contactName: String(p.contactName ?? ""),
      happenedAt: d,
      telephonyResult: p.telephonyResult ?? null,
      telephonyCallbackPending: Boolean(p.telephonyCallbackPending),
      telephonyAnsweredConnected: Boolean(p.telephonyAnsweredConnected),
    };
  } catch {
    return null;
  }
}

type RcParty = {
  direction?: string;
  /** RC usually sends `{ code: "Proceeding" }`; some payloads use a string. */
  status?: { code?: string } | string;
  from?: RcPhoneEndpoint;
  to?: RcPhoneEndpoint;
};

type SessionPayload = {
  sessionId: string;
  parties: RcParty[];
  /**
   * Call start time from webhook body/parties when RingCentral sends it.
   * Avoids using hangup time (`new Date()`) as `happenedAt` on the placeholder row.
   */
  webhookStubHappenedAt?: Date | null;
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function parseOptionalIsoDate(v: unknown): Date | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Prefer session-level times, then earliest party `startTime` (call start, not hangup). */
function webhookStubHappenedAtFromBody(body: Record<string, unknown>, parties: RcParty[]): Date | null {
  for (const k of ["creationTime", "sessionStartTime", "startTime", "originalStartTime"] as const) {
    const d = parseOptionalIsoDate(body[k]);
    if (d) return d;
  }
  let earliest: Date | null = null;
  for (const p of parties) {
    const raw = p as Record<string, unknown>;
    const d = parseOptionalIsoDate(raw.startTime ?? raw.sessionStartTime ?? raw.creationTime);
    if (d && (!earliest || d.getTime() < earliest.getTime())) earliest = d;
  }
  return earliest;
}

function formatPhoneDisplay(digits: string, callLog10: string | null): string {
  const d = digitsOnly(callLog10 ?? digits);
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length >= 3 && d.length < MIN_DIGITS_LOOKUP) {
    return `Ext. ${d}`;
  }
  return digits || "Active call";
}

function partyStatusCode(p: RcParty): string {
  const s = p.status;
  if (typeof s === "string") return s;
  if (s && typeof s === "object" && s !== null && "code" in s) {
    return String((s as { code?: string }).code ?? "");
  }
  return "";
}

function isPartyEnded(p: RcParty): boolean {
  const code = partyStatusCode(p)
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  if (!code) return false;
  const compact = code.replace(/\s+/g, "");
  return (
    compact === "gone" ||
    compact === "nocall" ||
    compact === "canceled" ||
    compact === "cancelled" ||
    compact === "missed" ||
    code.includes("disconnect") ||
    code.includes("hang up") ||
    code.includes("terminated") ||
    code.includes("reject") ||
    code.includes("voice mail") ||
    code.includes("voicemail") ||
    code.includes("fax receive")
  );
}

function pickParties(raw: unknown): RcParty[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((p): p is RcParty => Boolean(p) && typeof p === "object");
  }
  if (typeof raw === "object") {
    return [raw as RcParty];
  }
  return [];
}

/** Session id sometimes appears only on the notification `event` path, not inside `body`. */
function sessionIdFromEventField(envelope: unknown): string {
  if (!envelope || typeof envelope !== "object") return "";
  const ev = String((envelope as { event?: string }).event ?? "").trim();
  const m = ev.match(/\/telephony\/sessions\/([^/?]+)\/?(?:\?|$)/i) ?? ev.match(/telephony\/sessions\/([^/?]+)/i);
  return (m?.[1] ?? "").trim();
}

function unwrapBody(envelope: unknown): unknown {
  if (!envelope || typeof envelope !== "object") return envelope;
  const e = envelope as Record<string, unknown>;
  let inner: unknown = e.body !== undefined ? e.body : envelope;
  if (typeof inner === "string") {
    try {
      inner = JSON.parse(inner) as unknown;
    } catch {
      return null;
    }
  }
  return inner;
}

function extractSessionPayloads(envelope: unknown): SessionPayload[] {
  if (Array.isArray(envelope)) {
    const out: SessionPayload[] = [];
    for (const item of envelope) {
      out.push(...extractSessionPayloads(item));
    }
    return out;
  }

  if (envelope && typeof envelope === "object" && Array.isArray((envelope as { records?: unknown }).records)) {
    const out: SessionPayload[] = [];
    for (const rec of (envelope as { records: unknown[] }).records) {
      out.push(...extractSessionPayloads(rec));
    }
    return out;
  }

  const inner = unwrapBody(envelope);
  if (!inner || typeof inner !== "object") return [];
  const b = inner as Record<string, unknown>;

  if (Array.isArray(b.sequences)) {
    const out: SessionPayload[] = [];
    for (const seq of b.sequences) {
      if (!seq || typeof seq !== "object") continue;
      const s = seq as Record<string, unknown>;
      const sid = String(s.sessionId ?? s.telephonySessionId ?? b.sessionId ?? b.telephonySessionId ?? "").trim();
      const parties = pickParties(s.parties ?? b.parties);
      if (sid && parties.length) {
        const merged = { ...b, ...s } as Record<string, unknown>;
        out.push({
          sessionId: sid,
          parties,
          webhookStubHappenedAt: webhookStubHappenedAtFromBody(merged, parties),
        });
      }
    }
    if (out.length) return out;
  }

  const sid = String(b.sessionId ?? b.telephonySessionId ?? b.id ?? "").trim();
  const parties = pickParties(b.parties);
  if (sid && parties.length) {
    return [{ sessionId: sid, parties, webhookStubHappenedAt: webhookStubHappenedAtFromBody(b, parties) }];
  }
  return [];
}

/**
 * RingCentral often puts the telephony session id only on the notification `event` URL; `body` then has `parties` but
 * no `sessionId`. Without this, we would parse zero payloads and the dock stays empty.
 */
function payloadsWithEventSessionFallback(envelope: unknown, extracted: SessionPayload[]): SessionPayload[] {
  if (extracted.length > 0) return extracted;
  const eventSid = sessionIdFromEventField(envelope);
  if (!eventSid) return extracted;
  const inner = unwrapBody(envelope);
  if (!inner || typeof inner !== "object") return extracted;
  const b = inner as Record<string, unknown>;

  let parties = pickParties(b.parties);
  if (!parties.length && Array.isArray(b.sequences)) {
    for (const seq of b.sequences) {
      if (!seq || typeof seq !== "object") continue;
      const s = seq as Record<string, unknown>;
      parties = pickParties(s.parties ?? b.parties);
      if (parties.length) break;
    }
  }
  if (!parties.length) return extracted;
  if (process.env.NODE_ENV === "development") {
    console.info("[telephony-webhook] Using session id from `event` field (body had no sessionId).");
  }
  return [{ sessionId: eventSid, parties, webhookStubHappenedAt: webhookStubHappenedAtFromBody(b, parties) }];
}

function pickDisplayParty(parties: RcParty[]): RcParty | null {
  const active = parties.filter((p) => !isPartyEnded(p));
  if (!active.length) return null;
  const inbound = active.find((p) => String(p.direction ?? "").toLowerCase().includes("inbound"));
  if (inbound) return inbound;
  return active[0] ?? null;
}

function customerFromParty(p: RcParty): {
  digits: string;
  callLog10: string | null;
  name: string | null;
  direction: CallDirection;
} | null {
  const dir = String(p.direction ?? "").toLowerCase();
  const direction = dir.includes("outbound") ? CallDirection.OUTBOUND : CallDirection.INBOUND;
  const got = pickCustomerPhoneFromRcFromTo(direction, p.from, p.to);
  if (!got) return null;
  return { ...got, direction };
}

function shouldDropSession(parties: RcParty[]): boolean {
  if (!parties.length) return true;
  return parties.every((p) => isPartyEnded(p));
}

type CustomerPartyPick = NonNullable<ReturnType<typeof customerFromParty>>;

/**
 * Multi-leg sessions: the first party with digits is often an internal/outbound leg; inbound call history only
 * lists INBOUND rows. Prefer any party that maps to INBOUND before OUTBOUND.
 */
function pickCustomerFromSessionParties(parties: RcParty[]): CustomerPartyPick | null {
  const candidates: CustomerPartyPick[] = [];
  for (const p of parties) {
    const c = customerFromParty(p);
    if (c) candidates.push(c);
  }
  if (!candidates.length) return null;
  const inbound = candidates.find((c) => c.direction === CallDirection.INBOUND);
  return inbound ?? candidates[0]!;
}

function normalizePartyStatusCode(code: string): string {
  return code.replace(/_/g, " ").trim().toLowerCase();
}

/** Per-leg duration when RingCentral includes it on session parties (seconds). */
function partyDurationSeconds(p: RcParty): number {
  const r = p as Record<string, unknown>;
  const ms = r.durationMs;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
    return Math.min(Math.round(ms / 1000), 86400);
  }
  const d = r.duration;
  if (typeof d === "number" && Number.isFinite(d) && d >= 0) {
    return Math.min(Math.round(d), 86400);
  }
  if (typeof d === "string" && /^\d+$/.test(d.trim())) {
    return Math.min(parseInt(d.trim(), 10), 86400);
  }
  return 0;
}

/**
 * After hangup, the answered leg often ends as Disconnected while a parallel hunt leg shows Missed.
 * Do not treat the whole session as missed when any leg clearly had a live conversation.
 */
function partyTerminalStatusImpliesAnsweredConversation(statusCode: string): boolean {
  const raw = statusCode.trim();
  if (ringCentralResultLooksAnsweredConnectedRaw(raw)) return true;
  const n = normalizePartyStatusCode(raw);
  if (!n) return false;
  if (n.includes("missed") || n.includes("voicemail") || n.includes("voice mail")) return false;
  if (n.includes("stopped")) return false;
  if (n.includes("disconnect") || n.includes("hang up") || n.includes("hangup")) return true;
  return false;
}

function webhookStubDispositionFromParties(
  parties: RcParty[],
): Pick<
  TelephonyWebhookSessionStubInput,
  "telephonyResult" | "telephonyCallbackPending" | "telephonyAnsweredConnected"
> {
  const statuses = parties.map((p) => partyStatusCode(p));
  const text = statuses.join(" ").toLowerCase();
  if (/\bvoicemail\b|\bvoice\s*mail\b/.test(text)) {
    return { telephonyResult: "Voicemail", telephonyCallbackPending: true, telephonyAnsweredConnected: false };
  }
  if (/\bfax\b/.test(text)) {
    return { telephonyResult: "Fax", telephonyCallbackPending: false, telephonyAnsweredConnected: false };
  }
  if (/\bcanceled\b|\bcancelled\b/.test(text)) {
    return { telephonyResult: "Canceled", telephonyCallbackPending: false, telephonyAnsweredConnected: false };
  }

  const maxPartyDurationSec = parties.reduce((m, p) => Math.max(m, partyDurationSeconds(p)), 0);
  const anyAnsweredLeg = statuses.some((s) => partyTerminalStatusImpliesAnsweredConversation(s));
  /** Meaningful talk time on a leg — hunt "missed" rings are usually a few seconds. */
  if (anyAnsweredLeg || maxPartyDurationSec >= 20) {
    return { telephonyResult: "Call completed", telephonyCallbackPending: false, telephonyAnsweredConnected: true };
  }

  if (statuses.some((s) => normalizePartyStatusCode(s).includes("missed")) || /\bmissed\b/.test(text)) {
    return { telephonyResult: "Missed", telephonyCallbackPending: true, telephonyAnsweredConnected: false };
  }
  return { telephonyResult: "Call completed", telephonyCallbackPending: false, telephonyAnsweredConnected: true };
}

/**
 * Process RingCentral account telephony session webhook payload(s).
 * Upserts one row per session for the live dock; deletes when the session has fully ended.
 */
export async function applyRingCentralTelephonyWebhookBody(
  envelope: unknown,
): Promise<{
  processed: number;
  payloadsSeen: number;
  /** Deferred `syncSingleRingCentralCallLogByCrmId` runs (RingCentral recording URLs often lag hangup). */
  recordingRefreshJobs: Array<{ callLogId: string; delayMs: number }>;
  /** Deferred CRM import after session-end grace (avoids premature Missed while calls forward). */
  sessionFinalizeJobs: Array<{ sessionId: string; token: string; delayMs: number }>;
}> {
  const payloads = payloadsWithEventSessionFallback(envelope, extractSessionPayloads(envelope));
  let processed = 0;
  const recordingRefreshJobs: Array<{ callLogId: string; delayMs: number }> = [];
  const sessionFinalizeJobs: Array<{ sessionId: string; token: string; delayMs: number }> = [];

  for (const payload of payloads) {
    if (shouldDropSession(payload.parties)) {
      const cust = pickCustomerFromSessionParties(payload.parties);
      const disp = webhookStubDispositionFromParties(payload.parties);
      const stub: TelephonyWebhookSessionStubInput = {
        telephonySessionId: payload.sessionId,
        direction: cust?.direction ?? CallDirection.INBOUND,
        phoneNormalized: cust?.digits ?? "",
        contactPhone10: cust?.callLog10 ?? null,
        contactName: sanitizeTelephonyContactName(cust?.name ?? null),
        happenedAt: payload.webhookStubHappenedAt ?? new Date(),
        ...disp,
      };
      const graceMs = getTelephonySessionEndGraceMs();
      if (graceMs <= 0) {
        await deleteTelephonyLiveSession(payload.sessionId);
        try {
          const outcome = await importCallLogForTelephonySessionEnd(stub);
          if (outcome) {
            recordingRefreshJobs.push(...buildTelephonyRecordingRefreshJobs(outcome.callLogId));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("[telephony-webhook] importCallLogForTelephonySessionEnd failed:", msg);
        }
      } else {
        const token = randomUUID();
        const graceUntil = new Date(Date.now() + graceMs).toISOString();
        const dirStr = stub.direction === CallDirection.OUTBOUND ? "OUTBOUND" : "INBOUND";
        const digits = (cust?.digits ?? digitsOnly(stub.phoneNormalized)).trim();
        await upsertTelephonyLiveSession({
          telephonySessionId: payload.sessionId,
          direction: dirStr,
          statusCode: TELEPHONY_LIVE_STATUS_FINISHING,
          phoneDigits: digits,
          phoneDisplay: cust
            ? formatPhoneDisplay(cust.digits, cust.callLog10)
            : dirStr === "INBOUND"
              ? "Incoming call"
              : "Active call",
          callerName: sanitizeTelephonyContactName(cust?.name ?? null),
          endingGraceUntil: graceUntil,
          endingStubJson: stubToPersistedJson(stub),
          endingToken: token,
        });
        sessionFinalizeJobs.push({ sessionId: payload.sessionId, token, delayMs: graceMs });
      }
      processed += 1;
      continue;
    }

    const party = pickDisplayParty(payload.parties);
    if (!party) {
      await deleteTelephonyLiveSession(payload.sessionId);
      processed += 1;
      continue;
    }

    const cust = customerFromParty(party);
    const statusCode = String(partyStatusCode(party) || "Unknown").trim() || "Unknown";
    const dirStr = String(party.direction ?? "").toLowerCase().includes("outbound") ? "OUTBOUND" : "INBOUND";

    if (cust) {
      await upsertTelephonyLiveSession({
        telephonySessionId: payload.sessionId,
        direction: dirStr,
        statusCode,
        phoneDigits: cust.digits,
        phoneDisplay: formatPhoneDisplay(cust.digits, cust.callLog10),
        callerName: cust.name,
        endingGraceUntil: null,
        endingStubJson: null,
        endingToken: null,
      });
    } else {
      await upsertTelephonyLiveSession({
        telephonySessionId: payload.sessionId,
        direction: dirStr,
        statusCode,
        phoneDigits: "",
        phoneDisplay:
          String(party.direction ?? "").toLowerCase().includes("inbound") ? "Incoming call" : "Active call",
        callerName: party.from?.name?.trim() || party.to?.name?.trim() || null,
        endingGraceUntil: null,
        endingStubJson: null,
        endingToken: null,
      });
    }
    processed += 1;
  }

  return { processed, payloadsSeen: payloads.length, recordingRefreshJobs, sessionFinalizeJobs };
}

export function telephonyLiveRowsToDockSummaries(rows: TelephonyLiveSessionRow[]): ExtensionActiveCallSummary[] {
  return rows.map((r) => ({
    key: r.telephonySessionId,
    direction: r.direction === "OUTBOUND" ? CallDirection.OUTBOUND : CallDirection.INBOUND,
    phoneDigits: r.phoneDigits,
    phoneDisplay: r.phoneDisplay,
    callerName: r.callerName,
    livePhase: r.endingToken?.trim() ? ("finishing" as const) : ("active" as const),
  }));
}

/**
 * Runs after {@link getTelephonySessionEndGraceMs}: import call log and clear the live row.
 * Idempotent if the session row was superseded (token mismatch).
 */
export async function finalizeDeferredTelephonySessionEnd(
  sessionId: string,
  token: string,
): Promise<{ recordingRefreshJobs: Array<{ callLogId: string; delayMs: number }> }> {
  const recordingRefreshJobs: Array<{ callLogId: string; delayMs: number }> = [];
  const row = await getTelephonyLiveSessionRow(sessionId);
  if (!row?.endingToken || row.endingToken.trim() !== token.trim()) {
    return { recordingRefreshJobs };
  }
  const rawJson = row.endingStubJson;
  if (!rawJson?.trim()) {
    await deleteTelephonyLiveSession(sessionId);
    return { recordingRefreshJobs };
  }
  const stub = persistedJsonToStub(rawJson);
  if (!stub) {
    await deleteTelephonyLiveSession(sessionId);
    return { recordingRefreshJobs };
  }
  try {
    const outcome = await importCallLogForTelephonySessionEnd(stub);
    if (outcome) {
      recordingRefreshJobs.push(...buildTelephonyRecordingRefreshJobs(outcome.callLogId));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[telephony-webhook] finalizeDeferredTelephonySessionEnd import failed:", msg);
  } finally {
    await deleteTelephonyLiveSession(sessionId);
  }
  return { recordingRefreshJobs };
}
