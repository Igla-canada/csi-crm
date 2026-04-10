"use client";

import { useLiveUiSync } from "@/components/live-ui-sync";

export function LiveWorkspaceHeader() {
  const { liveUiSyncEnabled, setLiveUiSyncEnabled } = useLiveUiSync();

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white/90 px-3 py-2 shadow-sm">
      <p className="text-sm font-medium text-slate-700">Live sync</p>
      <button
        type="button"
        role="switch"
        aria-checked={liveUiSyncEnabled}
        aria-label={liveUiSyncEnabled ? "Live sync on" : "Live sync off"}
        onClick={() => setLiveUiSyncEnabled(!liveUiSyncEnabled)}
        className={`relative inline-flex h-8 w-12 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e5ea8] ${
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
