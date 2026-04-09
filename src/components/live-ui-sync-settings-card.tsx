"use client";

import { useLiveUiSync } from "@/components/live-ui-sync";

export function LiveUiSyncSettingsCard() {
  const {
    liveUiSyncEnabled,
    setLiveUiSyncEnabled,
    refreshIntervalSec,
    refreshTiedToActivePoll,
    activeCallPollSec,
    ringCentralConfigured,
  } = useLiveUiSync();

  return (
    <section className="crm-soft-panel rounded-[28px] p-6">
      <h3 className="text-xl font-semibold text-slate-900">Live UI refresh</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        The main switch lives in the <span className="font-medium text-slate-800">top header</span> on every page (same
        setting). When it is on and RingCentral is configured, the CRM also polls for{" "}
        <span className="font-medium text-slate-800">active calls</span> on the JWT extension and can show the live call
        dock (see project <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">docs/live-call-dock-setup.md</code>
        ). Optional page auto-refresh uses <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">NEXT_PUBLIC_UI_LIVE_REFRESH_SEC</code> — set a number (seconds, min 8) or <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">sync</code> to match active-call polling. Active-call polling uses{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">NEXT_PUBLIC_LIVE_ACTIVE_CALL_POLL_SEC</code>{" "}
        (default {activeCallPollSec}s).
      </p>
      {ringCentralConfigured ? (
        <p className="mt-2 text-xs text-slate-500">
          RingCentral env detected — call dock runs when Live sync is on and your role can use Log a Call.
        </p>
      ) : null}
      {refreshIntervalSec <= 0 ? (
        <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Auto-refresh is not active until{" "}
          <code className="rounded bg-white px-1 py-0.5 text-xs ring-1 ring-slate-200">
            NEXT_PUBLIC_UI_LIVE_REFRESH_SEC
          </code>{" "}
          is set to a positive number in the environment (for example{" "}
          <code className="rounded bg-white px-1 py-0.5 text-xs ring-1 ring-slate-200">60</code> for every 60 seconds),
          then restart the app.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-3 rounded-[22px] border border-slate-200/90 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Refresh open pages automatically</p>
            <p className="mt-1 text-xs text-slate-600">
              About every {refreshIntervalSec} second{refreshIntervalSec === 1 ? "" : "s"} while this tab is visible
              {refreshTiedToActivePoll ? " (tied to live call poll)." : "."} The Log a call page is not auto-refreshed.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={liveUiSyncEnabled}
            onClick={() => setLiveUiSyncEnabled(!liveUiSyncEnabled)}
            className={`relative inline-flex h-9 w-[3.25rem] shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e5ea8] ${
              liveUiSyncEnabled ? "bg-[#1e5ea8]" : "bg-slate-300"
            }`}
          >
            <span className="sr-only">{liveUiSyncEnabled ? "On" : "Off"}</span>
            <span
              className={`pointer-events-none absolute top-1 left-1 size-7 rounded-full bg-white shadow transition-transform ${
                liveUiSyncEnabled ? "translate-x-[1.35rem]" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      )}
    </section>
  );
}
