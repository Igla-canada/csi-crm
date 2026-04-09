import "server-only";

import { CallDirection, type CallDirection as CallDirectionType } from "@/lib/db";

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

/** Prefer top-level `result`, then first non-empty leg `result` / `action`. */
function rawResultFromRecord(rec: Record<string, unknown>): string {
  const top = str(rec.result);
  if (top) return top;
  const legs = rec.legs;
  if (!Array.isArray(legs)) return "";
  for (const leg of legs) {
    if (!leg || typeof leg !== "object" || Array.isArray(leg)) continue;
    const o = leg as Record<string, unknown>;
    const r = str(o.result);
    if (r) return r;
    const a = str(o.action);
    if (a) return a;
  }
  return "";
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
  const raw = rawResultFromRecord(rec);
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
