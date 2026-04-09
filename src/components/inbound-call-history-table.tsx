"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { CallHistoryOpenLogButton } from "@/components/call-history-open-log-button";
import { useLiveUiSync } from "@/components/live-ui-sync";
import { INBOUND_CALL_HISTORY_REFRESH_EVENT } from "@/lib/call-history-refresh-event";
import type { InboundCallHistoryRowDto } from "@/lib/inbound-call-history-dto";
import type { ActiveDockCallSnapshot } from "@/lib/live-dock-call-types";
import {
  isInboundHistoryOpenLogSuppressedByLiveDock,
  navigateOpenLiveCallLogFromDock,
} from "@/lib/live-dock-open-log-client";
import { TELEPHONY_CALL_SUMMARY_PLACEHOLDER } from "@/lib/telephony-call-placeholder";

function formatWhen(iso: string) {
  return format(parseISO(iso), "MMM d, yyyy · h:mm a");
}

function normPhoneDigits(raw: string | null | undefined): string {
  let x = (raw ?? "").replace(/\D/g, "");
  if (x.length === 11 && x.startsWith("1")) x = x.slice(1);
  return x;
}

function dockLineMatchesRow(dock: ActiveDockCallSnapshot, row: InboundCallHistoryRowDto): boolean {
  if (dock.direction === "OUTBOUND") return false;
  const rd = normPhoneDigits(row.contactPhone);
  const dd = normPhoneDigits(dock.phoneDigits);
  if (!rd || !dd) return false;
  return rd === dd;
}

function LiveDockSyntheticOpenLogButton({ dock }: { dock: ActiveDockCallSnapshot }) {
  const router = useRouter();
  const { canLogCalls } = useLiveUiSync();
  const [pending, startTransition] = useTransition();

  if (!canLogCalls) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await navigateOpenLiveCallLogFromDock(dock, router, canLogCalls);
        });
      }}
      className="rounded-xl bg-[#1e5ea8] px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#17497f] disabled:opacity-50"
    >
      {pending ? "Opening…" : "Open log"}
    </button>
  );
}

export function InboundCallHistoryTable({ initialRows }: { initialRows: InboundCallHistoryRowDto[] }) {
  const { liveUiSyncEnabled, activeCallPollSec, refreshIntervalSec, activeDockCalls } = useLiveUiSync();
  const [rows, setRows] = useState<InboundCallHistoryRowDto[]>(initialRows);
  const fetchSeqRef = useRef(0);
  const [, setSuppressTick] = useState(0);

  const pollSec = refreshIntervalSec > 0 ? refreshIntervalSec : activeCallPollSec;
  const pollMs = Math.max(pollSec * 1000, 8000);

  const fetchRows = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const res = await fetch("/api/calls/inbound-history", { credentials: "include" });
      const data = (await res.json()) as { rows?: InboundCallHistoryRowDto[]; error?: string };
      if (!res.ok || !Array.isArray(data.rows)) return;
      if (seq !== fetchSeqRef.current) return;
      setRows(data.rows);
    } catch {
      /* keep last good snapshot */
    }
  }, []);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    if (!liveUiSyncEnabled) return;
    void fetchRows();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchRows();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [liveUiSyncEnabled, pollMs, fetchRows]);

  useEffect(() => {
    if (!liveUiSyncEnabled) return;
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchRows();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [liveUiSyncEnabled, fetchRows]);

  useEffect(() => {
    const onExternal = () => void fetchRows();
    window.addEventListener(INBOUND_CALL_HISTORY_REFRESH_EVENT, onExternal);
    return () => window.removeEventListener(INBOUND_CALL_HISTORY_REFRESH_EVENT, onExternal);
  }, [fetchRows]);

  useEffect(() => {
    const bump = () => setSuppressTick((t) => t + 1);
    window.addEventListener("csicrm:dock-open-log-suppress", bump);
    return () => window.removeEventListener("csicrm:dock-open-log-suppress", bump);
  }, []);

  const merged = useMemo(() => {
    const inboundDock = activeDockCalls.filter((c) => c.direction !== "OUTBOUND");
    const synthetic = inboundDock
      .filter((d) => !rows.some((r) => dockLineMatchesRow(d, r)))
      .map((dock) => ({ kind: "synthetic" as const, dock }));
    const db = rows.map((row) => ({ kind: "db" as const, row }));
    return [...synthetic, ...db];
  }, [rows, activeDockCalls]);

  if (merged.length === 0) {
    return <p className="text-sm text-slate-600">No inbound calls on file yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="py-3 pr-4">When</th>
            <th className="py-3 pr-4">Client</th>
            <th className="py-3 pr-4">Caller</th>
            <th className="py-3 pr-4">Phone</th>
            <th className="py-3 pr-4">Summary</th>
            <th className="py-3 pl-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {merged.map((item) => {
            if (item.kind === "synthetic") {
              const { dock } = item;
              return (
                <tr
                  key={`dock-live:${dock.key}`}
                  className="border-b border-slate-100 bg-emerald-50/40 last:border-0"
                >
                  <td className="py-3 pr-4 align-top text-slate-700">
                    <span className="font-medium text-emerald-800">Live now</span>
                  </td>
                  <td className="py-3 pr-4 align-top font-medium text-slate-500">—</td>
                  <td className="py-3 pr-4 align-top text-slate-700">{dock.callerName?.trim() || "—"}</td>
                  <td className="py-3 pr-4 align-top text-slate-700">{dock.phoneDisplay}</td>
                  <td className="max-w-xs py-3 pr-4 align-top text-slate-600">
                    <span className="line-clamp-2">
                      Incoming call in progress — open the log from the dock or here. This row disappears when
                      the line clears.
                    </span>
                  </td>
                  <td className="py-3 pl-2 align-top text-right">
                    <LiveDockSyntheticOpenLogButton dock={dock} />
                  </td>
                </tr>
              );
            }

            const { row } = item;
            const summaryTrim = row.summary?.trim() ?? "";
            const dockSuppressed = isInboundHistoryOpenLogSuppressedByLiveDock(
              row.contactPhone,
              row.telephonyDraft,
              summaryTrim,
              TELEPHONY_CALL_SUMMARY_PLACEHOLDER,
            );
            const openLogDisabled = row.openLogDisabled || dockSuppressed;

            return (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 pr-4 align-top text-slate-700">{formatWhen(row.happenedAt)}</td>
                <td className="py-3 pr-4 align-top font-medium text-slate-900">
                  <Link
                    href={`/clients/${row.clientId}`}
                    className="text-[#1e5ea8] hover:text-[#17497f] hover:underline"
                  >
                    {row.clientDisplayName}
                  </Link>
                </td>
                <td className="py-3 pr-4 align-top text-slate-700">{row.contactName?.trim() || "—"}</td>
                <td className="py-3 pr-4 align-top text-slate-700">{row.contactPhone?.trim() || "—"}</td>
                <td className="max-w-xs py-3 pr-4 align-top text-slate-600">
                  <span className="line-clamp-2">{row.summary?.trim() || "—"}</span>
                </td>
                <td className="py-3 pl-2 align-top text-right">
                  <CallHistoryOpenLogButton callLogId={row.id} disabled={openLogDisabled} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
