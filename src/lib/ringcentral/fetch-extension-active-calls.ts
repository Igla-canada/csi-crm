import "server-only";

import { CallDirection } from "@/lib/db";
import { aggregatePathErrorsAreAllRateLimited } from "@/lib/ringcentral/active-calls-error";
import {
  pickCustomerPhoneFromRcFromTo,
  type RcPhoneEndpoint,
} from "@/lib/ringcentral/customer-phone-from-rc-parties";
import { getExtensionActiveCallsPollPlan } from "@/lib/ringcentral/env";
import {
  markRingCentralRestCallDone,
  paceBeforeRingCentralRestCall,
  retryAfterDelayMsFromHeaders,
} from "@/lib/ringcentral/rc-request-pace";
import { getRingCentralPlatform } from "@/lib/ringcentral/platform";

/** Space out multi-extension active-calls GETs to avoid burst rate limits (4+ extensions). */
const BETWEEN_EXTENSION_POLL_MS = 2000;

const MIN_DIGITS_LOOKUP = 7;

type RcActiveRecord = {
  id?: string;
  sessionId?: string;
  direction?: string;
  from?: RcPhoneEndpoint;
  to?: RcPhoneEndpoint;
  /** Present on many payloads; absent means we cannot infer end state (keep row). */
  telephonyStatus?: string;
  result?: string;
};

/** RC often keeps rows in `active-calls` briefly after hangup; drop clearly finished sessions. */
function telephonyStatusLooksEnded(raw: string | undefined): boolean {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .trim();
  if (!s) return false;
  const compact = s.replace(/\s+/g, "");
  return (
    compact === "gone" ||
    compact === "nocall" ||
    compact === "canceled" ||
    compact === "cancelled" ||
    /\bdisconnect/.test(s) ||
    /\bhang\s*up/.test(s) ||
    /\bhangup/.test(compact) ||
    /\bterminated/.test(s) ||
    /\bvoice\s*mail\b/.test(s) ||
    /\bvoicemail\b/.test(s) ||
    /\bmissed\b/.test(s)
  );
}

type RcActiveListResponse = {
  records?: RcActiveRecord[];
};

function mapDirection(raw: string | undefined): CallDirection | null {
  const d = String(raw ?? "").toLowerCase();
  if (d.includes("inbound")) return CallDirection.INBOUND;
  if (d.includes("outbound")) return CallDirection.OUTBOUND;
  return null;
}

function directionForRecord(rec: RcActiveRecord): CallDirection {
  return mapDirection(rec.direction) ?? CallDirection.INBOUND;
}

function pickCustomerParty(
  r: RcActiveRecord,
  direction: CallDirection,
): { digits: string; callLog10: string | null; name: string | null } | null {
  return pickCustomerPhoneFromRcFromTo(direction, r.from, r.to);
}

function formatPhoneDisplay(digits: string, callLog10: string | null): string {
  const d = (callLog10 ?? digits).replace(/\D/g, "");
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length >= 3 && d.length < MIN_DIGITS_LOOKUP) {
    return `Ext. ${d}`;
  }
  return digits;
}

export type ExtensionActiveCallSummary = {
  /** Stable key for React (RC telephony session when present). */
  key: string;
  direction: CallDirection;
  phoneDigits: string;
  phoneDisplay: string;
  callerName: string | null;
  /** Webhook-only: call ended in RC but CRM import is deferred (grace window). */
  livePhase?: "active" | "finishing";
};

export type ExtensionActiveCallsFetchMeta = {
  summaries: ExtensionActiveCallSummary[];
  /** Sum of `records.length` from each RingCentral response before filtering. */
  rawRecordCount: number;
  /** Sum of rows skipped as ended across polls. */
  skippedEnded: number;
  /** Human-readable poll targets (JWT ~ or list of extension ids). */
  pollTargetDescription: string;
  /** Every extension leg failed with rate limit — treat as empty so the client can run post-call hide logic. */
  extensionPollRateLimited?: boolean;
};

function mapRecordsToSummaries(records: RcActiveRecord[]): {
  summaries: ExtensionActiveCallSummary[];
  skippedEnded: number;
} {
  const out: ExtensionActiveCallSummary[] = [];
  let skippedEnded = 0;

  for (const rec of records) {
    const statusHint = String(rec.telephonyStatus ?? rec.result ?? "").trim();
    if (telephonyStatusLooksEnded(statusHint)) {
      skippedEnded += 1;
      continue;
    }

    const direction = directionForRecord(rec);
    const sid = String(rec.sessionId ?? "").trim();
    const id = String(rec.id ?? "").trim();
    const keyBase = sid || id;
    const party = pickCustomerParty(rec, direction);
    if (party) {
      const key = keyBase || `${direction}-${party.digits}-${out.length}`;
      out.push({
        key,
        direction,
        phoneDigits: party.digits,
        phoneDisplay: formatPhoneDisplay(party.digits, party.callLog10),
        callerName: party.name,
      });
      continue;
    }
    if (!keyBase) continue;
    const nameFromParty =
      (direction === CallDirection.INBOUND ? rec.from?.name : rec.to?.name) ??
      (direction === CallDirection.INBOUND ? rec.to?.name : rec.from?.name) ??
      null;
    out.push({
      key: keyBase,
      direction,
      phoneDigits: "",
      phoneDisplay: direction === CallDirection.INBOUND ? "Incoming call" : "Active call",
      callerName: nameFromParty?.trim() ? nameFromParty.trim() : null,
    });
  }

  return { summaries: out, skippedEnded };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchActiveCallsForSinglePath(
  platform: Awaited<ReturnType<typeof getRingCentralPlatform>>,
  path: string,
): Promise<{ summaries: ExtensionActiveCallSummary[]; rawRecordCount: number; skippedEnded: number }> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await paceBeforeRingCentralRestCall();
    let resp: Awaited<ReturnType<typeof platform.get>>;
    try {
      resp = await platform.get(path);
    } catch (e) {
      markRingCentralRestCallDone();
      const msg = e instanceof Error ? e.message : String(e);
      const st =
        /parameter\s*\[extensionId\]\s*is not found|extensionid.*not found/i.test(msg) ? 404 : 502;
      throw new Error(`RingCentral active-calls failed (${st}): ${msg.slice(0, 400)}`);
    }
    markRingCentralRestCallDone();

    if (resp.status === 429 && attempt < maxAttempts - 1) {
      await resp.text().catch(() => "");
      const fromHeader = retryAfterDelayMsFromHeaders(resp.headers);
      const stagger = 1800 * (attempt + 1);
      let waitMs = Math.max(stagger, fromHeader ?? 0, 55_000);
      waitMs = Math.min(waitMs, 120_000);
      await sleepMs(waitMs);
      continue;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`RingCentral active-calls failed (${resp.status}): ${text.slice(0, 400)}`);
    }
    const body = (await resp.json()) as RcActiveListResponse;
    const records = body.records ?? [];
    const { summaries, skippedEnded } = mapRecordsToSummaries(records);
    return { summaries, rawRecordCount: records.length, skippedEnded };
  }
  throw new Error("RingCentral active-calls failed (429): exhausted retries.");
}

/**
 * Read-only: active calls for JWT extension (~) and/or each id in `RINGCENTRAL_ACTIVE_CALLS_EXTENSION_ID(S)`.
 * Merges by session key; duplicate keys from multiple extensions keep the last poll’s row.
 */
export async function fetchExtensionActiveCallsWithMeta(): Promise<ExtensionActiveCallsFetchMeta> {
  const plan = getExtensionActiveCallsPollPlan();
  const platform = await getRingCentralPlatform();
  const merged = new Map<string, ExtensionActiveCallSummary>();
  let rawRecordCount = 0;
  let skippedEnded = 0;
  const pathErrors: string[] = [];

  for (let i = 0; i < plan.paths.length; i++) {
    const path = plan.paths[i]!;
    if (i > 0) {
      await new Promise((r) => setTimeout(r, BETWEEN_EXTENSION_POLL_MS));
    }
    try {
      const part = await fetchActiveCallsForSinglePath(platform, path);
      rawRecordCount += part.rawRecordCount;
      skippedEnded += part.skippedEnded;
      for (const s of part.summaries) {
        merged.set(s.key, s);
      }
    } catch (e) {
      pathErrors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (pathErrors.length === plan.paths.length) {
    if (aggregatePathErrorsAreAllRateLimited(pathErrors)) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[fetchExtensionActiveCallsWithMeta] All extension polls rate-limited; returning empty so dock can clear.",
        );
      }
      return {
        summaries: [],
        rawRecordCount: 0,
        skippedEnded: 0,
        pollTargetDescription: plan.describeTarget,
        extensionPollRateLimited: true,
      };
    }
    throw new Error(pathErrors.join(" | "));
  }
  if (pathErrors.length > 0 && process.env.NODE_ENV === "development") {
    console.warn("[fetchExtensionActiveCallsWithMeta] Some extension polls failed:", pathErrors);
  }

  return {
    summaries: [...merged.values()],
    rawRecordCount,
    skippedEnded,
    pollTargetDescription: plan.describeTarget,
  };
}
