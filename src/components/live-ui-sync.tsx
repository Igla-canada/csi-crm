"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { LiveCallDock } from "@/components/live-call-dock";
import type { ActiveDockCallSnapshot } from "@/lib/live-dock-call-types";

const STORAGE_KEY = "csicrm_live_ui_refresh";

/** Floor for extension active-calls polling — multi-line accounts hit RingCentral limits quickly below ~30s. */
const MIN_ACTIVE_CALL_POLL_SEC = 30;

function readActiveCallPollSec(): number {
  const raw = process.env.NEXT_PUBLIC_LIVE_ACTIVE_CALL_POLL_SEC;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.min(Math.max(Math.floor(n), MIN_ACTIVE_CALL_POLL_SEC), 120);
    }
  }
  return MIN_ACTIVE_CALL_POLL_SEC;
}

/** Page refresh interval: seconds (8–120), or match active-call poll via `sync` / `live`. */
function parseUiLiveRefreshSec(pollSec: number): { refreshSec: number; tiedToActivePoll: boolean } {
  const raw = process.env.NEXT_PUBLIC_UI_LIVE_REFRESH_SEC;
  if (raw == null || raw.trim() === "") return { refreshSec: 0, tiedToActivePoll: false };
  const t = raw.trim();
  if (/^(sync|live)$/i.test(t)) {
    return { refreshSec: pollSec, tiedToActivePoll: true };
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return { refreshSec: 0, tiedToActivePoll: false };
  const floor = 8;
  return { refreshSec: Math.min(Math.max(Math.floor(n), floor), 120), tiedToActivePoll: false };
}

type LiveUiSyncContextValue = {
  liveUiSyncEnabled: boolean;
  setLiveUiSyncEnabled: (next: boolean) => void;
  refreshIntervalSec: number;
  /** True when env is `sync` or `live` — interval tracks `activeCallPollSec`. */
  refreshTiedToActivePoll: boolean;
  activeCallPollSec: number;
  ringCentralConfigured: boolean;
  canLogCalls: boolean;
  canViewCallsSection: boolean;
  /** Latest lines from the live dock (for merging into Call history). */
  activeDockCalls: ActiveDockCallSnapshot[];
};

const LiveUiSyncContext = createContext<LiveUiSyncContextValue | null>(null);

export function useLiveUiSync(): LiveUiSyncContextValue {
  const ctx = useContext(LiveUiSyncContext);
  if (!ctx) {
    throw new Error("useLiveUiSync must be used within LiveUiSyncProvider");
  }
  return ctx;
}

type ProviderProps = {
  children: ReactNode;
  ringCentralConfigured: boolean;
  canLogCalls: boolean;
  canViewCallsSection: boolean;
};

export function LiveUiSyncProvider({
  children,
  ringCentralConfigured,
  canLogCalls,
  canViewCallsSection,
}: ProviderProps) {
  const { refreshIntervalSec, activeCallPollSec, refreshTiedToActivePoll } = useMemo(() => {
    const poll = readActiveCallPollSec();
    const { refreshSec, tiedToActivePoll } = parseUiLiveRefreshSec(poll);
    return {
      activeCallPollSec: poll,
      refreshIntervalSec: refreshSec,
      refreshTiedToActivePoll: tiedToActivePoll,
    };
  }, []);
  const [liveUiSyncEnabled, setLiveUiSyncEnabledState] = useState(true);
  const [activeDockCalls, setActiveDockCalls] = useState<ActiveDockCallSnapshot[]>([]);
  const reportActiveDockCalls = useCallback((next: ActiveDockCallSnapshot[]) => {
    setActiveDockCalls(next);
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "0") setLiveUiSyncEnabledState(false);
    } catch {
      /* private mode */
    }
  }, []);

  const setLiveUiSyncEnabled = useCallback((next: boolean) => {
    setLiveUiSyncEnabledState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      liveUiSyncEnabled,
      setLiveUiSyncEnabled,
      refreshIntervalSec,
      refreshTiedToActivePoll,
      activeCallPollSec,
      ringCentralConfigured,
      canLogCalls,
      canViewCallsSection,
      activeDockCalls,
    }),
    [
      liveUiSyncEnabled,
      setLiveUiSyncEnabled,
      refreshIntervalSec,
      refreshTiedToActivePoll,
      activeCallPollSec,
      ringCentralConfigured,
      canLogCalls,
      canViewCallsSection,
      activeDockCalls,
    ],
  );

  return (
    <LiveUiSyncContext.Provider value={value}>
      <LiveUiRefresh />
      {children}
      <LiveCallDock onCallsSnapshotChange={reportActiveDockCalls} />
    </LiveUiSyncContext.Provider>
  );
}

function LiveUiRefresh() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { liveUiSyncEnabled, refreshIntervalSec, activeCallPollSec } = useLiveUiSync();
  const idRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Only the history list (not /calls log form) — periodic refresh would reset in-progress drafts.
  const callHistoryAutoRefresh =
    refreshIntervalSec <= 0 &&
    liveUiSyncEnabled &&
    activeCallPollSec > 0 &&
    pathname === "/calls/history";

  const intervalSec =
    refreshIntervalSec > 0 ? refreshIntervalSec : callHistoryAutoRefresh ? activeCallPollSec : 0;

  useEffect(() => {
    if (!liveUiSyncEnabled || intervalSec <= 0) {
      if (idRef.current != null) {
        clearInterval(idRef.current);
        idRef.current = null;
      }
      return;
    }

    const ms = intervalSec * 1000;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      // Log a call lives at /calls — full RSC refresh would remount and discard in-progress drafts.
      if (pathname === "/calls") return;
      router.refresh();
    };
    idRef.current = setInterval(tick, ms);
    return () => {
      if (idRef.current != null) {
        clearInterval(idRef.current);
        idRef.current = null;
      }
    };
  }, [router, liveUiSyncEnabled, intervalSec, pathname]);

  return null;
}
