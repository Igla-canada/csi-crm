import "server-only";

import { parseTelephonyRecordingRefsJson, WEBHOOK_TELEPHONY_LOG_ID_PREFIX } from "@/lib/crm";
import { getSupabaseAdmin, tables } from "@/lib/db";
import { getRingCentralAutoTranscribe } from "@/lib/ringcentral/env";
import {
  syncSingleRingCentralCallLogByCrmId,
  type SyncSingleRingCentralCallLogResult,
} from "@/lib/ringcentral/sync-call-logs";
import { shouldStartAutoTranscriptionForCallLog, startRingCentralSpeechToTextForCallLog } from "@/lib/ringcentral/transcribe";

const MIN_END_AGE_MS = 3 * 60 * 1000;
const LOOKBACK_DAYS = 30;
/** Few rows per run — each `syncSingle` fans out to many RingCentral call-log GETs (Heavy tier ~10/min). */
const DEFAULT_BATCH = 5;
const MAX_ATTEMPTS_BEFORE_NONE = 12;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
/** After RingCentral 429, wait at least this long before this row is eligible again (penalty interval is often ~60s; stay conservative). */
const MIN_BACKOFF_AFTER_RATE_LIMIT_MS = 10 * 60 * 1000;

function interRowDelayMs(): number {
  const raw = process.env.RECORDING_ENRICHMENT_INTER_ROW_DELAY_MS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return Math.min(n, 120_000);
  }
  /** Space out runs so one cron invocation does not dump dozens of call-log reads into the same Heavy bucket. */
  return 8000;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type EnrichRow = {
  id: string;
  happenedAt: string;
  ringCentralCallLogId: string | null;
  telephonyRecordingContentUri: string | null;
  telephonyRecordingRefs: unknown;
  telephonyRecordingEnrichStatus: string | null;
  telephonyRecordingEnrichAttempts: number | null;
  telephonyRecordingEnrichLastAt: string | null;
  telephonyRecordingEnrichNextAt: string | null;
};

export function rowHasTelephonyRecording(row: {
  telephonyRecordingContentUri?: string | null;
  telephonyRecordingRefs?: unknown;
}): boolean {
  if (String(row.telephonyRecordingContentUri ?? "").trim()) return true;
  const refs = parseTelephonyRecordingRefsJson(row.telephonyRecordingRefs);
  return Boolean(refs && refs.length > 0);
}

function enrichBackoffMs(nextAttempt1Based: number): number {
  const n = Math.min(Math.max(nextAttempt1Based, 1), 12);
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** (n - 1));
}

async function maybeStartAutoTranscribe(callLogId: string): Promise<void> {
  if (!getRingCentralAutoTranscribe()) return;
  try {
    if (await shouldStartAutoTranscriptionForCallLog(callLogId)) {
      await startRingCentralSpeechToTextForCallLog(callLogId);
    }
  } catch {
    /* non-fatal */
  }
}

async function fetchEligibleRows(limit: number): Promise<EnrichRow[]> {
  const sb = getSupabaseAdmin();
  const now = Date.now();
  const minHappened = new Date(now - LOOKBACK_DAYS * 86400_000).toISOString();
  const maxHappened = new Date(now - MIN_END_AGE_MS).toISOString();

  const { data, error } = await sb
    .from(tables.CallLog)
    .select(
      "id,happenedAt,ringCentralCallLogId,telephonyRecordingContentUri,telephonyRecordingRefs,telephonyRecordingEnrichStatus,telephonyRecordingEnrichAttempts,telephonyRecordingEnrichLastAt,telephonyRecordingEnrichNextAt",
    )
    .not("ringCentralCallLogId", "is", null)
    .in("telephonyRecordingEnrichStatus", ["pending", "retry"])
    .gte("happenedAt", minHappened)
    .lte("happenedAt", maxHappened)
    .order("happenedAt", { ascending: false })
    .limit(Math.min(limit * 4, 120));

  if (error) throw error;
  const rows = (data ?? []) as EnrichRow[];
  const t = Date.now();
  return rows
    .filter((r) => {
      const next = r.telephonyRecordingEnrichNextAt;
      if (!next) return true;
      const ts = new Date(next).getTime();
      return !Number.isNaN(ts) && ts <= t;
    })
    .slice(0, limit);
}

async function applyEnrichmentOutcome(
  callLogId: string,
  args: { syncOk: boolean; priorAttempts: number; hadRecordingBefore: boolean; rateLimited?: boolean },
): Promise<void> {
  const sb = getSupabaseAdmin();
  const { data: row, error } = await sb
    .from(tables.CallLog)
    .select(
      "id,telephonyRecordingContentUri,telephonyRecordingRefs,ringCentralCallLogId,telephonyRecordingEnrichAttempts",
    )
    .eq("id", callLogId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return;

  const hasRec = rowHasTelephonyRecording(row as EnrichRow);
  if (hasRec) {
    await sb
      .from(tables.CallLog)
      .update({
        telephonyRecordingEnrichStatus: "ready",
        telephonyRecordingEnrichNextAt: null,
        telephonyRecordingEnrichLastAt: new Date().toISOString(),
      })
      .eq("id", callLogId);
    if (!args.hadRecordingBefore) {
      await maybeStartAutoTranscribe(callLogId);
    }
    return;
  }

  const nextAttempt = args.priorAttempts + 1;
  const lastAt = new Date().toISOString();
  const rcKey = String((row as { ringCentralCallLogId?: string }).ringCentralCallLogId ?? "").trim();

  if (!args.syncOk) {
    const baseWait = enrichBackoffMs(nextAttempt);
    const waitMs = args.rateLimited ? Math.max(baseWait, MIN_BACKOFF_AFTER_RATE_LIMIT_MS) : baseWait;
    await sb
      .from(tables.CallLog)
      .update({
        telephonyRecordingEnrichStatus: "retry",
        telephonyRecordingEnrichAttempts: nextAttempt,
        telephonyRecordingEnrichLastAt: lastAt,
        telephonyRecordingEnrichNextAt: new Date(Date.now() + waitMs).toISOString(),
      })
      .eq("id", callLogId);
    return;
  }

  const isPlaceholder = rcKey.startsWith(WEBHOOK_TELEPHONY_LOG_ID_PREFIX);
  if (isPlaceholder) {
    await sb
      .from(tables.CallLog)
      .update({
        telephonyRecordingEnrichStatus: "pending",
        telephonyRecordingEnrichAttempts: nextAttempt,
        telephonyRecordingEnrichLastAt: lastAt,
        telephonyRecordingEnrichNextAt: new Date(Date.now() + enrichBackoffMs(nextAttempt)).toISOString(),
      })
      .eq("id", callLogId);
    return;
  }

  if (nextAttempt >= MAX_ATTEMPTS_BEFORE_NONE) {
    await sb
      .from(tables.CallLog)
      .update({
        telephonyRecordingEnrichStatus: "none",
        telephonyRecordingEnrichAttempts: nextAttempt,
        telephonyRecordingEnrichLastAt: lastAt,
        telephonyRecordingEnrichNextAt: null,
      })
      .eq("id", callLogId);
    return;
  }

  await sb
    .from(tables.CallLog)
    .update({
      telephonyRecordingEnrichStatus: "retry",
      telephonyRecordingEnrichAttempts: nextAttempt,
      telephonyRecordingEnrichLastAt: lastAt,
      telephonyRecordingEnrichNextAt: new Date(Date.now() + enrichBackoffMs(nextAttempt)).toISOString(),
    })
    .eq("id", callLogId);
}

/**
 * Picks RingCentral-linked call logs that still need a recording URI, re-syncs them from RC, and updates
 * `telephonyRecordingEnrichStatus` (ready | none | retry) with backoff. Intended for Vercel Cron / external GET.
 */
export async function runTelephonyRecordingEnrichmentCron(options?: { limit?: number }): Promise<{
  scanned: number;
  processed: number;
  ready: number;
  none: number;
  retrying: number;
  failures: number;
}> {
  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_BATCH, 1), 80);
  const rows = await fetchEligibleRows(limit);
  let ready = 0;
  let none = 0;
  let retrying = 0;
  let failures = 0;

  const rowDelay = interRowDelayMs();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (i > 0 && rowDelay > 0) {
      await sleepMs(rowDelay);
    }
    const hadRecordingBefore = rowHasTelephonyRecording(r);
    const priorAttempts = Number(r.telephonyRecordingEnrichAttempts ?? 0) || 0;

    try {
      const result: SyncSingleRingCentralCallLogResult = await syncSingleRingCentralCallLogByCrmId(r.id);
      const rateLimited = result.ok === false && Boolean(result.rateLimited);
      await applyEnrichmentOutcome(r.id, {
        syncOk: result.ok,
        priorAttempts,
        hadRecordingBefore,
        rateLimited,
      });

      const sb = getSupabaseAdmin();
      const { data: after } = await sb
        .from(tables.CallLog)
        .select("telephonyRecordingEnrichStatus")
        .eq("id", r.id)
        .maybeSingle();
      const st = String((after as { telephonyRecordingEnrichStatus?: string } | null)?.telephonyRecordingEnrichStatus ?? "");
      if (st === "ready") ready += 1;
      else if (st === "none") none += 1;
      else retrying += 1;
    } catch (e) {
      failures += 1;
      console.warn("[recording-enrichment-cron]", r.id, e);
      try {
        await applyEnrichmentOutcome(r.id, {
          syncOk: false,
          priorAttempts,
          hadRecordingBefore,
          rateLimited: false,
        });
      } catch {
        /* ignore */
      }
    }
  }

  return {
    scanned: rows.length,
    processed: rows.length,
    ready,
    none,
    retrying,
    failures,
  };
}
