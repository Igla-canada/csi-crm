import "server-only";

import { CallDirection, type CallDirection as CallDirectionType } from "@/lib/db";
import { getRingCentralCallLogStagingExtensionNumbers } from "@/lib/ringcentral/env";

/** Parsed from RingCentral account/extension call-log `view=Detailed` payloads. */
export type RingCentralCallDisposition = {
  /** Human-readable label for CRM UI (e.g. "Voicemail", "Missed", "Answered"). */
  resultLabel: string | null;
  /** When true, show on Tasks → call follow-ups until staff finishes the telephony draft or changes outcome. */
  callbackPending: boolean;
  /**
   * True only when RC `result` clearly indicates answered/connected (not missing/unknown).
   * Used to auto-archive older RingCentral callback stubs for the same client.
   */
  answeredConnected: boolean;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function numDuration(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.min(v, 86400);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Math.min(parseInt(v.trim(), 10), 86400);
  return 0;
}

/** RC / TELUS may send one object instead of a one-element `legs` array. */
function normalizeLegsRaw(raw: unknown): Record<string, unknown>[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object" && !Array.isArray(l));
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return [raw as Record<string, unknown>];
  return [];
}

function durationFromParty(o: Record<string, unknown>): number {
  const ms = o.durationMs;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
    return Math.min(Math.round(ms / 1000), 86400);
  }
  return numDuration(o.duration);
}

/**
 * True when this `result` string describes the call being answered / connected (not a hunt-group miss,
 * FindMe "Stopped", voicemail, etc.). Used to pick the right leg when TELUS logs ext 101 Missed + 102 Accepted.
 */
export function ringCentralResultLooksAnsweredConnectedRaw(raw: string): boolean {
  const norm = raw.toLowerCase().replace(/_/g, " ");
  if (!norm) return false;
  if (norm.includes("stopped")) return false;
  if (norm.includes("missed")) return false;
  if (norm.includes("voicemail") || norm.includes("voice mail")) return false;
  if (norm.includes("no answer") || norm.includes("noanswer")) return false;
  if (norm.includes("rejected") || norm.includes("declined") || norm.includes("failed")) return false;
  if (norm.includes("unavailable") || norm.includes("offline")) return false;
  if (norm.includes("busy") && !norm.includes("connected")) return false;
  if (norm.includes("cancelled") || norm.includes("canceled")) return false;
  return (
    /\baccepted\b/.test(norm) ||
    /\bconnected\b/.test(norm) ||
    /\banswer(ed)?\b/.test(norm) ||
    norm === "call connected" ||
    /\bcompleted\b/.test(norm) ||
    /\bsuccess(ful)?\b/.test(norm) ||
    /\breceived\b/.test(norm) ||
    norm.includes("inbound connected") ||
    norm.includes("call answered")
  );
}

function rankAnsweredResultLabel(raw: string): number {
  const n = raw.toLowerCase();
  if (n.includes("call connected")) return 100;
  if (n.includes("accepted")) return 90;
  if (n.includes("connected")) return 80;
  if (n.includes("completed")) return 70;
  return 50;
}

type ResultCandidate = { raw: string; durationSec: number; leg: Record<string, unknown> };

/** Prefer explicit RC `extensionNumber` so we do not treat short PSTN fragments as staging extensions. */
function endpointExtensionNumberDigits(ep: unknown): string {
  if (!ep || typeof ep !== "object") return "";
  const o = ep as Record<string, unknown>;
  return String(o.extensionNumber ?? "").replace(/\D/g, "");
}

function legTouchesStagingExtension(leg: Record<string, unknown>, staging: ReadonlySet<string>): boolean {
  if (staging.size === 0) return false;
  for (const k of ["from", "to"] as const) {
    const d = endpointExtensionNumberDigits(leg[k]);
    if (d && staging.has(d)) return true;
  }
  return false;
}

function rawLooksMissedOrNoAnswer(raw: string): boolean {
  const n = raw.toLowerCase().replace(/_/g, " ");
  return n.includes("missed") || n.includes("no answer") || n.includes("noanswer");
}

function collectResultCandidates(rec: Record<string, unknown>): ResultCandidate[] {
  const out: ResultCandidate[] = [];
  const push = (raw: unknown, dur: number, leg: Record<string, unknown>) => {
    const r = str(raw);
    if (!r) return;
    out.push({ raw: r, durationSec: dur, leg });
  };

  push(rec.result, durationFromParty(rec), rec);

  const walk = (legs: unknown) => {
    for (const leg of normalizeLegsRaw(legs)) {
      const L = leg as Record<string, unknown>;
      push(L.result, durationFromParty(L), L);
      walk(L.legs);
    }
  };
  walk(rec.legs);
  return out;
}

function candidateIsIgnorableStagingMiss(c: ResultCandidate, staging: ReadonlySet<string>): boolean {
  return staging.size > 0 && rawLooksMissedOrNoAnswer(c.raw) && legTouchesStagingExtension(c.leg, staging);
}

/**
 * Picks the `result` string that best represents the customer experience for multi-leg TELUS/RC flows:
 * if any leg is answered/connected, prefer that — longest duration first (main conversation leg), then label rank.
 * Otherwise fall back to the first result in the tree (often a short "Missed" on one extension only).
 */
function bestRawResultForDisposition(rec: Record<string, unknown>): string {
  const cands = collectResultCandidates(rec);
  if (!cands.length) return "";

  const answered = cands.filter((c) => ringCentralResultLooksAnsweredConnectedRaw(c.raw));
  if (answered.length) {
    answered.sort((a, b) => {
      if (b.durationSec !== a.durationSec) return b.durationSec - a.durationSec;
      return rankAnsweredResultLabel(b.raw) - rankAnsweredResultLabel(a.raw);
    });
    return answered[0]!.raw;
  }

  const staging = getRingCentralCallLogStagingExtensionNumbers();
  const withoutStagingMiss = cands.filter((c) => !candidateIsIgnorableStagingMiss(c, staging));
  const pool = withoutStagingMiss.length ? withoutStagingMiss : cands;
  pool.sort((a, b) => {
    if (b.durationSec !== a.durationSec) return b.durationSec - a.durationSec;
    return rankAnsweredResultLabel(b.raw) - rankAnsweredResultLabel(a.raw);
  });
  return pool[0]!.raw;
}

function titleCaseWords(s: string): string {
  const t = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t
    .split(" ")
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

/**
 * RingCentral `result` strings vary by product; match common voicemail / missed / no-answer patterns.
 * "Accepted" / "Connected" / "Call connected" → no automatic callback task.
 */
export function dispositionFromRingCentralRecord(
  rec: Record<string, unknown>,
  direction: CallDirectionType,
): RingCentralCallDisposition {
  const raw = bestRawResultForDisposition(rec);
  if (!raw) {
    return { resultLabel: null, callbackPending: false, answeredConnected: false };
  }

  const norm = raw.toLowerCase().replace(/_/g, " ");

  const answeredHints =
    /\baccepted\b/.test(norm) ||
    /\bconnected\b/.test(norm) ||
    /\banswer(ed)?\b/.test(norm) ||
    norm === "call connected" ||
    /\bcompleted\b/.test(norm) ||
    /\bsuccess(ful)?\b/.test(norm) ||
    /\breceived\b/.test(norm) ||
    norm.includes("inbound connected") ||
    norm.includes("call answered");

  if (answeredHints && !norm.includes("voicemail") && !norm.includes("voice mail")) {
    return {
      resultLabel: titleCaseWords(raw),
      callbackPending: false,
      answeredConnected: true,
    };
  }

  const callbackHints =
    norm.includes("voicemail") ||
    norm.includes("voice mail") ||
    norm.includes("missed") ||
    norm.includes("no answer") ||
    norm.includes("noanswer") ||
    norm.includes("busy") ||
    norm.includes("rejected") ||
    norm.includes("declined") ||
    norm.includes("failed") ||
    norm.includes("unavailable") ||
    norm.includes("offline") ||
    (norm.includes("hang up") && direction === CallDirection.INBOUND);

  const label = titleCaseWords(raw);
  return {
    resultLabel: label || null,
    callbackPending: callbackHints,
    answeredConnected: false,
  };
}

/**
 * When RingCentral / TELUS splits one call into multiple call-log ids (hunt groups, transfers), the row we
 * import may only contain a short "Missed" on ext 101 while another session row has "Accepted" on ext 102.
 * If the primary row is not answered/connected, check peer rows from the same telephony session.
 */
export function dispositionFromRingCentralRecordWithSessionContext(
  primary: Record<string, unknown>,
  direction: CallDirectionType,
  sessionPeerMetas: Record<string, unknown>[] | undefined,
): RingCentralCallDisposition {
  const d0 = dispositionFromRingCentralRecord(primary, direction);
  if (d0.answeredConnected) return d0;

  for (const peer of sessionPeerMetas ?? []) {
    const d = dispositionFromRingCentralRecord(peer, direction);
    if (d.answeredConnected) return d;
  }
  return d0;
}

/**
 * Fallback when `answeredConnected` was false but the stored label clearly indicates a live answered call
 * (some RingCentral payloads omit or vary the raw `result` field used during import).
 */
export function telephonyResultLabelImpliesAnsweredConnected(label: string | null | undefined): boolean {
  if (!label?.trim()) return false;
  const norm = label.toLowerCase().replace(/_/g, " ");
  if (norm.includes("voicemail") || norm.includes("voice mail")) return false;
  if (
    norm.includes("missed") ||
    norm.includes("no answer") ||
    norm.includes("noanswer") ||
    norm.includes("busy") ||
    norm.includes("rejected") ||
    norm.includes("declined") ||
    norm.includes("failed") ||
    norm.includes("unavailable") ||
    norm.includes("offline")
  ) {
    return false;
  }
  return (
    /\baccepted\b/.test(norm) ||
    /\bconnected\b/.test(norm) ||
    /\banswer(ed)?\b/.test(norm) ||
    norm === "call connected" ||
    /\bcompleted\b/.test(norm) ||
    /\bsuccess(ful)?\b/.test(norm) ||
    /\breceived\b/.test(norm) ||
    norm.includes("inbound connected") ||
    norm.includes("call answered")
  );
}
