"use client";

import { useLiveUiSync } from "@/components/live-ui-sync";

export function LiveWorkspaceHeader() {
  const {
    liveUiSyncEnabled,
    setLiveUiSyncEnabled,
    refreshIntervalSec,
    refreshTiedToActivePoll,
    activeCallPollSec,
    ringCentralConfigured,
    canViewCallsSection,
  } = useLiveUiSync();

  const refreshOn = refreshIntervalSec > 0;
  const callHistoryAutoRefreshHint =
    !refreshOn &&
    liveUiSyncEnabled &&
    activeCallPollSec > 0 &&
    ringCentralConfigured &&
    canViewCallsSection;
  const showRcHint = !ringCentralConfigured;

  return (
    <div className="flex flex-col items-stretch gap-1 rounded-2xl border border-slate-200/90 bg-white/90 px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Live sync</p>
        <p className="text-xs leading-snug text-slate-600">
          {liveUiSyncEnabled
            ? refreshOn
              ? refreshTiedToActivePoll
                ? `Page data ~every ${refreshIntervalSec}s (same as live call poll)`
                : `Page data ~every ${refreshIntervalSec}s`
              : callHistoryAutoRefreshHint
                ? `Call history auto-refreshes ~every ${activeCallPollSec}s (set NEXT_PUBLIC_UI_LIVE_REFRESH_SEC for all pages)`
                : "On (set NEXT_PUBLIC_UI_LIVE_REFRESH_SEC to refresh other pages)"
            : "Paused — safe for debugging"}
          {showRcHint ? (
            <span className="block text-[11px] text-slate-400">RingCentral env off — no call dock</span>
          ) : !canViewCallsSection ? (
            <span className="block text-[11px] text-slate-400">Call dock needs Calls section access</span>
          ) : liveUiSyncEnabled ? (
            <span className="block text-[11px] text-slate-400">Dock: telephony webhooks (default)</span>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={liveUiSyncEnabled}
        aria-label="Toggle live sync"
        onClick={() => setLiveUiSyncEnabled(!liveUiSyncEnabled)}
        className={`relative inline-flex h-8 w-12 shrink-0 self-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e5ea8] sm:self-auto ${
          liveUiSyncEnabled ? "bg-[#1e5ea8]" : "bg-slate-300"
        }`}
      >
        <span className="sr-only">{liveUiSyncEnabled ? "On" : "Off"}</span>
        <span
          className={`pointer-events-none absolute top-0.5 left-0.5 size-7 rounded-full bg-white shadow transition-transform ${
            liveUiSyncEnabled ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
