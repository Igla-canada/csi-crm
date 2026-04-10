import "server-only";

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
import { importCallLogForTelephonySessionEnd } from "@/lib/ringcentral/sync-call-logs";
import {
  deleteTelephonyLiveSession,
  type TelephonyLiveSessionRow,
  upsertTelephonyLiveSession,
} from "@/lib/ringcentral/telephony-live-sessions";

const MIN_DIGITS_LOOKUP = 7;

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
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
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
      if (sid && parties.length) out.push({ sessionId: sid, parties });
    }
    if (out.length) return out;
  }

  const sid = String(b.sessionId ?? b.telephonySessionId ?? b.id ?? "").trim();
  const parties = pickParties(b.parties);
  if (sid && parties.length) return [{ sessionId: sid, parties }];
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
  return [{ sessionId: eventSid, parties }];
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

function pickCustomerFromSessionParties(parties: RcParty[]): ReturnType<typeof customerFromParty> | null {
  for (const p of parties) {
    const c = customerFromParty(p);
    if (c) return c;
  }
  return null;
}

function webhookStubDispositionFromParties(
  parties: RcParty[],
): Pick<
  TelephonyWebhookSessionStubInput,
  "telephonyResult" | "telephonyCallbackPending" | "telephonyAnsweredConnected"
> {
  const text = parties.map((p) => partyStatusCode(p)).join(" ").toLowerCase();
  if (/\bvoicemail\b|\bvoice\s*mail\b/.test(text)) {
    return { telephonyResult: "Voicemail", telephonyCallbackPending: true, telephonyAnsweredConnected: false };
  }
  if (/\bmissed\b/.test(text)) {
    return { telephonyResult: "Missed", telephonyCallbackPending: true, telephonyAnsweredConnected: false };
  }
  if (/\bfax\b/.test(text)) {
    return { telephonyResult: "Fax", telephonyCallbackPending: false, telephonyAnsweredConnected: false };
  }
  if (/\bcanceled\b|\bcancelled\b/.test(text)) {
    return { telephonyResult: "Canceled", telephonyCallbackPending: false, telephonyAnsweredConnected: false };
  }
  return { telephonyResult: "Call completed", telephonyCallbackPending: false, telephonyAnsweredConnected: true };
}

/**
 * Process RingCentral account telephony session webhook payload(s).
 * Upserts one row per session for the live dock; deletes when the session has fully ended.
 */
export async function applyRingCentralTelephonyWebhookBody(
  envelope: unknown,
): Promise<{ processed: number; payloadsSeen: number }> {
  const payloads = payloadsWithEventSessionFallback(envelope, extractSessionPayloads(envelope));
  let processed = 0;

  for (const payload of payloads) {
    if (shouldDropSession(payload.parties)) {
      await deleteTelephonyLiveSession(payload.sessionId);
      const cust = pickCustomerFromSessionParties(payload.parties);
      const disp = webhookStubDispositionFromParties(payload.parties);
      const stub: TelephonyWebhookSessionStubInput = {
        telephonySessionId: payload.sessionId,
        direction: cust?.direction ?? CallDirection.INBOUND,
        phoneNormalized: cust?.digits ?? "",
        contactPhone10: cust?.callLog10 ?? null,
        contactName: sanitizeTelephonyContactName(cust?.name ?? null),
        happenedAt: new Date(),
        ...disp,
      };
      try {
        await importCallLogForTelephonySessionEnd(stub);
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[telephony-webhook] importCallLogForTelephonySessionEnd:", e);
        }
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
      });
    }
    processed += 1;
  }

  return { processed, payloadsSeen: payloads.length };
}

export function telephonyLiveRowsToDockSummaries(rows: TelephonyLiveSessionRow[]): ExtensionActiveCallSummary[] {
  return rows.map((r) => ({
    key: r.telephonySessionId,
    direction: r.direction === "OUTBOUND" ? CallDirection.OUTBOUND : CallDirection.INBOUND,
    phoneDigits: r.phoneDigits,
    phoneDisplay: r.phoneDisplay,
    callerName: r.callerName,
  }));
}
