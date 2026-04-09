"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";

import { useLiveUiSync } from "@/components/live-ui-sync";
import { INBOUND_CALL_HISTORY_REFRESH_EVENT } from "@/lib/call-history-refresh-event";
import type { ActiveDockCallSnapshot } from "@/lib/live-dock-call-types";
import { navigateOpenLiveCallLogFromDock } from "@/lib/live-dock-open-log-client";

/**
 * After the post-call grace hides a line, RingCentral often returns the same session key once or twice
 * more; ignore those ghosts briefly so the card does not pop back in.
 */
const POST_GRACE_LINE_COOLDOWN_MS = 90_000;

function filterLinesAfterGraceDismiss(
  next: ActiveDockCallSnapshot[],
  dismissedAt: Map<string, number>,
  now: number,
): ActiveDockCallSnapshot[] {
  const out: ActiveDockCallSnapshot[] = [];
  for (const c of next) {
    const droppedAt = dismissedAt.get(c.key);
    if (droppedAt != null) {
      if (now - droppedAt < POST_GRACE_LINE_COOLDOWN_MS) {
        continue;
      }
      dismissedAt.delete(c.key);
    }
    out.push(c);
  }
  return out;
}

function pruneStaleGraceDismissEntries(dismissedAt: Map<string, number>, now: number) {
  const maxAge = POST_GRACE_LINE_COOLDOWN_MS * 4;
  for (const [k, t] of dismissedAt) {
    if (now - t > maxAge) dismissedAt.delete(k);
  }
}

export type LiveCallDockProps = {
  onCallsSnapshotChange?: (calls: ActiveDockCallSnapshot[]) => void;
};

function isRateLimitedResponse(res: Response, errorText: string, upstreamStatus?: number): boolean {
  if (res.status === 429) return true;
  if (upstreamStatus === 429) return true;
  return /\brate|throttl|exceeded|too many requests|quota/i.test(errorText);
}

/** After RingCentral reports no active lines, keep the last card(s) visible this long (time to tap “Open call log”). */
const POST_CALL_CARD_GRACE_MS = 30_000;

export function LiveCallDock({ onCallsSnapshotChange }: LiveCallDockProps) {
  const router = useRouter();
  const {
    liveUiSyncEnabled,
    ringCentralConfigured,
    canLogCalls,
    canViewCallsSection,
    activeCallPollSec,
  } = useLiveUiSync();

  const [calls, setCalls] = useState<ActiveDockCallSnapshot[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const pollSeqRef = useRef(0);
  /** After RingCentral rate limits, multiply delay (1 → 2 → 4 … capped). Reset on success. */
  const pollBackoffMultRef = useRef(1);
  /** Mirrors last non-empty snapshot so we know when an empty API response should start the hide timer. */
  const displayedCallsRef = useRef<ActiveDockCallSnapshot[]>([]);
  const hideAfterGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Session keys hidden after grace — same key may reappear from RC briefly; suppress during cooldown. */
  const graceDismissedAtByKeyRef = useRef<Map<string, number>>(new Map());
  const pollChainCancelRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPostCallGraceTimer = useCallback(() => {
    if (hideAfterGraceTimerRef.current != null) {
      clearTimeout(hideAfterGraceTimerRef.current);
      hideAfterGraceTimerRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    // Poll even when the tab is in the background so the dock can populate while the user
    // answers on the phone app or another window; skipping here caused “no dock” during calls.
    const seq = ++pollSeqRef.current;
    try {
      const res = await fetch("/api/ringcentral/active-calls", { credentials: "include" });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        if (seq !== pollSeqRef.current) return;
        pollBackoffMultRef.current = 1;
        setPollError(
          res.redirected || !ct.includes("json")
            ? "Session or API response was not JSON — try refreshing the page. If this persists, check you are signed in."
            : `Unexpected response (${res.status})`,
        );
        return;
      }
      let data: {
        ok?: boolean;
        configured?: boolean;
        calls?: ActiveDockCallSnapshot[];
        error?: string;
        upstreamStatus?: number;
        /** Server could not read extension active-calls (all legs rate-limited); empty list is not authoritative. */
        dockExtensionPollRateLimited?: boolean;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        if (seq !== pollSeqRef.current) return;
        pollBackoffMultRef.current = 1;
        setPollError("Could not parse server response. Try refreshing the page.");
        return;
      }
      if (seq !== pollSeqRef.current) return;
      const errText = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      const upstream =
        typeof data.upstreamStatus === "number" && Number.isFinite(data.upstreamStatus)
          ? data.upstreamStatus
          : undefined;

      if (!res.ok) {
        const rateLimited = isRateLimitedResponse(res, errText, upstream);
        if (rateLimited) {
          pollBackoffMultRef.current = Math.min(pollBackoffMultRef.current * 2, 8);
          setPollError("RingCentral rate limit — retrying more slowly. Lines below may be a few seconds old.");
          // Keep last good snapshot so the dock does not disappear during an active call.
        } else {
          pollBackoffMultRef.current = 1;
          setPollError(errText);
          // Keep showing last lines for transient errors; only clear on auth failure.
          if (res.status === 401) {
            clearPostCallGraceTimer();
            graceDismissedAtByKeyRef.current.clear();
            displayedCallsRef.current = [];
            setCalls([]);
          }
        }
        return;
      }

      const next = Array.isArray(data.calls) ? data.calls : [];
      const extensionPollUnknown =
        data.dockExtensionPollRateLimited === true && next.length === 0;

      if (extensionPollUnknown) {
        pollBackoffMultRef.current = Math.min(pollBackoffMultRef.current * 2, 8);
        setPollError(
          "RingCentral rate limit — active lines could not be refreshed. Retrying more slowly; cards below may be stale.",
        );
        return;
      }

      pollBackoffMultRef.current = 1;
      setPollError(null);
      pruneStaleGraceDismissEntries(graceDismissedAtByKeyRef.current, Date.now());
      if (data.configured === false) {
        clearPostCallGraceTimer();
        graceDismissedAtByKeyRef.current.clear();
        displayedCallsRef.current = [];
        setCalls([]);
        return;
      }
      if (next.length > 0) {
        const now = Date.now();
        const filtered = filterLinesAfterGraceDismiss(next, graceDismissedAtByKeyRef.current, now);
        clearPostCallGraceTimer();
        if (filtered.length > 0) {
          displayedCallsRef.current = filtered;
          setCalls(filtered);
        } else {
          displayedCallsRef.current = [];
          setCalls([]);
        }
      } else {
        const hadVisibleLines = displayedCallsRef.current.length > 0;
        if (hadVisibleLines) {
          if (hideAfterGraceTimerRef.current == null) {
            hideAfterGraceTimerRef.current = setTimeout(() => {
              hideAfterGraceTimerRef.current = null;
              const snapshot = displayedCallsRef.current;
              const droppedAt = Date.now();
              for (const c of snapshot) {
                graceDismissedAtByKeyRef.current.set(c.key, droppedAt);
              }
              displayedCallsRef.current = [];
              setCalls([]);
            }, POST_CALL_CARD_GRACE_MS);
          }
        } else {
          clearPostCallGraceTimer();
          displayedCallsRef.current = [];
          setCalls([]);
        }
      }
    } catch {
      if (seq !== pollSeqRef.current) return;
      pollBackoffMultRef.current = 1;
      setPollError("Network error");
      // Same as rate limits: do not wipe the card on a flaky tunnel / tab sleep.
    }
  }, [clearPostCallGraceTimer]);

  const pollRef = useRef(poll);
  pollRef.current = poll;

  /** When the dock sees a new or changed active line, nudge call history off the interval poll so the stub row appears as soon as sync writes it. */
  const prevActiveCallKeysRef = useRef("");
  const historyRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!liveUiSyncEnabled || !ringCentralConfigured || !canViewCallsSection || activeCallPollSec <= 0) {
      prevActiveCallKeysRef.current = "";
      if (historyRetryTimerRef.current) {
        clearTimeout(historyRetryTimerRef.current);
        historyRetryTimerRef.current = null;
      }
      return;
    }
    const keys = [...calls].map((c) => c.key).sort().join("\0");
    if (calls.length === 0) {
      prevActiveCallKeysRef.current = "";
      if (historyRetryTimerRef.current) {
        clearTimeout(historyRetryTimerRef.current);
        historyRetryTimerRef.current = null;
      }
      return;
    }
    if (keys === prevActiveCallKeysRef.current) return;
    prevActiveCallKeysRef.current = keys;
    window.dispatchEvent(new Event(INBOUND_CALL_HISTORY_REFRESH_EVENT));
    if (historyRetryTimerRef.current) clearTimeout(historyRetryTimerRef.current);
    historyRetryTimerRef.current = setTimeout(() => {
      historyRetryTimerRef.current = null;
      window.dispatchEvent(new Event(INBOUND_CALL_HISTORY_REFRESH_EVENT));
    }, 2500);
  }, [
    calls,
    liveUiSyncEnabled,
    ringCentralConfigured,
    canViewCallsSection,
    activeCallPollSec,
  ]);

  useEffect(() => {
    return () => {
      if (historyRetryTimerRef.current) {
        clearTimeout(historyRetryTimerRef.current);
        historyRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!liveUiSyncEnabled || !ringCentralConfigured || !canViewCallsSection || activeCallPollSec <= 0) {
      pollChainCancelRef.current = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      pollBackoffMultRef.current = 1;
      if (hideAfterGraceTimerRef.current != null) {
        clearTimeout(hideAfterGraceTimerRef.current);
        hideAfterGraceTimerRef.current = null;
      }
      displayedCallsRef.current = [];
      graceDismissedAtByKeyRef.current.clear();
      setCalls([]);
      setPollError(null);
      return;
    }

    pollChainCancelRef.current = false;
    const baseMs = Math.max(activeCallPollSec * 1000, 30_000);

    const scheduleNext = (delayMs: number) => {
      if (pollChainCancelRef.current) return;
      timeoutRef.current = setTimeout(runTick, delayMs);
    };

    const runTick = () => {
      if (pollChainCancelRef.current) return;
      void (async () => {
        await pollRef.current();
        if (pollChainCancelRef.current) return;
        const mult = pollBackoffMultRef.current;
        const delay = baseMs * mult;
        scheduleNext(delay);
      })();
    };

    void pollRef.current();
    scheduleNext(baseMs);

    return () => {
      pollChainCancelRef.current = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (hideAfterGraceTimerRef.current != null) {
        clearTimeout(hideAfterGraceTimerRef.current);
        hideAfterGraceTimerRef.current = null;
      }
    };
  }, [liveUiSyncEnabled, ringCentralConfigured, canViewCallsSection, activeCallPollSec]);

  useEffect(() => {
    if (!liveUiSyncEnabled || !ringCentralConfigured || !canViewCallsSection || activeCallPollSec <= 0) {
      return;
    }
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void pollRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [liveUiSyncEnabled, ringCentralConfigured, canViewCallsSection, activeCallPollSec]);

  useEffect(() => {
    onCallsSnapshotChange?.(calls);
  }, [calls, onCallsSnapshotChange]);

  const primary = calls[0] ?? null;

  const openCallLogFor = async (c: ActiveDockCallSnapshot) => {
    if (!canLogCalls) return;
    setOpening(true);
    try {
      await navigateOpenLiveCallLogFromDock(c, router, canLogCalls);
    } finally {
      setOpening(false);
    }
  };

  if (!liveUiSyncEnabled || !ringCentralConfigured || !canViewCallsSection) {
    return null;
  }

  if (activeCallPollSec <= 0) {
    return null;
  }

  const showListening = !primary && !pollError;

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[60] flex max-w-[min(100vw-2rem,320px)] flex-col items-end gap-2"
      aria-live="polite"
    >
      {pollError ? (
        <div className="pointer-events-auto rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950 shadow-lg">
          <p className="font-semibold">Live call dock</p>
          <p className="mt-1 text-amber-900/90">{pollError}</p>
        </div>
      ) : null}

      {showListening ? (
        <div
          className="pointer-events-none flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-md ring-1 ring-slate-900/5"
          title="Watching for live lines (telephony webhooks + optional extension poll)"
        >
          <span
            className="size-2 shrink-0 rounded-full bg-emerald-500/90 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]"
            aria-hidden
          />
          Live calls · listening
        </div>
      ) : null}

      {primary ? (
        <div className="pointer-events-auto flex max-h-[calc(100vh-5.5rem)] w-full max-w-[min(100vw-2rem,360px)] flex-col overflow-hidden rounded-[28px] border border-slate-200/90 bg-gradient-to-b from-slate-50 to-white shadow-2xl ring-1 ring-slate-900/5">
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/80 bg-slate-900 px-4 py-2">
            <Phone className="size-4 text-emerald-400" aria-hidden />
            <p className="text-xs font-semibold tracking-wide text-white uppercase">
              {calls.length > 1 ? `${calls.length} active lines` : "On a call"}
            </p>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-slate-200/80 overflow-y-auto overscroll-contain px-3 py-2">
            {calls.map((c) => (
              <li key={c.key} className="py-3 first:pt-2 last:pb-2">
                <p className="text-center text-[10px] font-semibold tracking-[0.2em] text-slate-400 uppercase">Line</p>
                <p className="mt-0.5 text-center text-xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {c.phoneDisplay}
                </p>
                {c.callerName?.trim() ? (
                  <p className="mt-0.5 text-center text-xs font-medium text-slate-600">{c.callerName.trim()}</p>
                ) : null}
                <p className="mt-1 text-center text-[11px] text-slate-500">
                  {c.direction === "OUTBOUND" ? "Outbound" : "Inbound"}
                </p>
                {canLogCalls ? (
                  <button
                    type="button"
                    disabled={opening}
                    onClick={() => void openCallLogFor(c)}
                    className="mt-3 w-full rounded-xl bg-[#1e5ea8] py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#17497f] disabled:opacity-50"
                  >
                    Open call log
                  </button>
                ) : (
                  <p className="mt-2 text-center text-[11px] text-slate-500">No permission to log calls.</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
