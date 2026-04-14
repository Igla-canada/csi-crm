"use client";

import Link from "next/link";
import { TZDate } from "@date-fns/tz";
import { endOfDay, format, parseISO, startOfDay, subDays } from "date-fns";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CallHistoryOpenLogButton } from "@/components/call-history-open-log-button";
import { CallLogRecordingPlayButton } from "@/components/call-log-recording-playback";
import { useLiveUiSync } from "@/components/live-ui-sync";
import { INBOUND_CALL_HISTORY_REFRESH_EVENT } from "@/lib/call-history-refresh-event";
import type { InboundCallHistoryRowDto } from "@/lib/inbound-call-history-dto";
import type { ActiveDockCallSnapshot } from "@/lib/live-dock-call-types";
import {
  isInboundHistoryOpenLogSuppressedByLiveDock,
  navigateOpenLiveCallLogFromDock,
} from "@/lib/live-dock-open-log-client";
import { telephonyResultLooksMissedOrUnanswered } from "@/lib/inbound-call-history-disposition";
import { formatInboundCallHistoryDuration } from "@/lib/inbound-call-history-format";
import { TELEPHONY_CALL_SUMMARY_PLACEHOLDER } from "@/lib/telephony-call-placeholder";
import { PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";

function InboundCallTypeIcon({
  direction,
  telephonyResult,
}: {
  direction: "INBOUND" | "OUTBOUND";
  telephonyResult?: string | null;
}) {
  const missed = telephonyResultLooksMissedOrUnanswered(telephonyResult ?? null);
  if (missed) {
    const label = "Missed / voicemail / no answer";
    return (
      <span className="inline-flex items-center justify-center text-slate-600" title={label}>
        <span className="sr-only">{label}</span>
        <PhoneMissed
          className="h-[1.125rem] w-[1.125rem] text-rose-600"
          aria-hidden
          strokeWidth={2.25}
        />
      </span>
    );
  }

  const out = direction === "OUTBOUND";
  const Icon = out ? PhoneOutgoing : PhoneIncoming;
  const label = out ? "Outgoing call" : "Incoming call";
  return (
    <span className="inline-flex items-center justify-center text-slate-600" title={label}>
      <span className="sr-only">{label}</span>
      <Icon
        className={out ? "h-[1.125rem] w-[1.125rem] text-amber-700" : "h-[1.125rem] w-[1.125rem] text-emerald-700"}
        aria-hidden
        strokeWidth={2.25}
      />
    </span>
  );
}

function formatWhenInShopTz(iso: string, timeZone: string) {
  const d = parseISO(iso);
  const z = new TZDate(d.getTime(), timeZone);
  return format(z, "MMM d, yyyy · h:mm a");
}

function InboundHistorySummaryHoverTip({
  fullText,
  children,
}: {
  fullText: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tipStyle, setTipStyle] = useState<CSSProperties>({
    position: "fixed",
    left: 0,
    top: 0,
    visibility: "hidden",
    zIndex: 9999,
    width: "min(26rem, calc(100vw - 1.5rem))",
    minWidth: "17rem",
    maxWidth: "min(26rem, calc(100vw - 1.5rem))",
    boxSizing: "border-box",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  const cancelHideSoon = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    cancelHideSoon();
    setVisible(false);
    setTipStyle((prev) => ({ ...prev, visibility: "hidden" }));
  }, [cancelHideSoon]);

  const hideSoon = useCallback(() => {
    cancelHideSoon();
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      hide();
    }, 200);
  }, [cancelHideSoon, hide]);

  useLayoutEffect(() => {
    if (!visible || !mounted || !tipRef.current || !triggerRef.current) return;
    const el = tipRef.current;
    const tr = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 10;
    const gap = 8;
    let left = tr.left;
    let top = tr.bottom + gap;
    const rect = el.getBoundingClientRect();
    if (left + rect.width > vw - margin) {
      left = Math.max(margin, vw - margin - rect.width);
    }
    if (left < margin) left = margin;
    if (top + rect.height > vh - margin) {
      top = Math.max(margin, tr.top - gap - rect.height);
    }
    if (top < margin) top = margin;
    setTipStyle((prev) => ({
      ...prev,
      left,
      top,
      visibility: "visible",
    }));
  }, [visible, mounted, fullText]);

  if (!fullText || fullText === "—") {
    return <>{children}</>;
  }

  const tip = (
    <div
      ref={tipRef}
      role="tooltip"
      className="rounded-xl border border-slate-200/90 bg-white px-4 py-3.5 text-left shadow-[0_10px_40px_-12px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/[0.06] antialiased max-h-[min(22rem,72vh)] overflow-y-auto overscroll-contain"
      style={tipStyle}
      onMouseEnter={cancelHideSoon}
      onMouseLeave={hideSoon}
    >
      <p className="text-pretty text-[13px] font-normal leading-[1.65] tracking-[-0.01em] text-slate-800 [overflow-wrap:anywhere] whitespace-pre-wrap break-words">
        {fullText}
      </p>
    </div>
  );

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-block max-w-full cursor-help"
        onMouseEnter={() => {
          cancelHideSoon();
          setTipStyle((prev) => ({ ...prev, visibility: "hidden" }));
          setVisible(true);
        }}
        onMouseLeave={hideSoon}
      >
        {children}
      </span>
      {mounted && visible ? createPortal(tip, document.body) : null}
    </>
  );
}

function InboundHistorySummaryCell({
  row,
  canRunGeminiTranscribe,
  refetch,
}: {
  row: InboundCallHistoryRowDto;
  canRunGeminiTranscribe: boolean;
  refetch: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const showTranscript =
    canRunGeminiTranscribe &&
    (row.recordingCount ?? 0) > 0 &&
    !row.hasTranscription &&
    !row.geminiTranscribePending &&
    !row.rcAiTranscribePending;

  const rawDisplay = row.displaySummary?.trim() ?? "";
  const effectiveDisplay = rawDisplay === TELEPHONY_CALL_SUMMARY_PLACEHOLDER ? "" : rawDisplay;

  const rawStaff = row.summary?.trim() ?? "";
  const effectiveStaff = rawStaff === TELEPHONY_CALL_SUMMARY_PLACEHOLDER ? "" : rawStaff;

  const showSummaryText = Boolean(effectiveDisplay);
  /**
   * Full text for hover: prefer staff-written summary when present, else the same text shown in the cell
   * (usually AI call insights). Rows with only AI used to skip the hover wrapper when staff was still the RC placeholder.
   */
  const hoverFullText = effectiveStaff || effectiveDisplay;

  return (
    <div className="space-y-1.5">
      {showSummaryText ? (
        <InboundHistorySummaryHoverTip fullText={hoverFullText}>
          <span className="line-clamp-3 text-sm leading-snug">{effectiveDisplay}</span>
        </InboundHistorySummaryHoverTip>
      ) : null}
      {row.geminiTranscribePending ? (
        <p className="text-[11px] font-medium text-slate-500">Transcribing…</p>
      ) : null}
      {showTranscript ? (
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setErr(null);
              void (async () => {
                try {
                  const res = await fetch("/api/calls/gemini-transcribe", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ callLogId: row.id }),
                  });
                  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
                  if (!res.ok) {
                    const msg =
                      (typeof data?.error === "string" && data.error) ||
                      (typeof data?.message === "string" && data.message) ||
                      `Request failed (${res.status}).`;
                    setErr(msg);
                    return;
                  }
                  await refetch();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Request failed.");
                } finally {
                  setPending(false);
                }
              })();
            }}
            className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-100 disabled:opacity-50"
          >
            {pending ? "Working…" : "Transcript"}
          </button>
          {err ? (
            <p className="max-w-[14rem] text-[11px] text-red-600" role="alert">
              {err}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function recordingLabel(count: number): { text: string; title: string } {
  if (count <= 0) return { text: "—", title: "No recording on file" };
  if (count === 1) return { text: "1", title: "1 recording" };
  return { text: String(count), title: `${count} recordings` };
}

function InboundHistoryRecordingCell({
  callLogId,
  recordingCount,
}: {
  callLogId: string;
  recordingCount: number;
}) {
  const n = Math.max(0, Math.floor(recordingCount));
  if (n <= 0) {
    return <span className="text-slate-500">—</span>;
  }

  const { title } = recordingLabel(n);

  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
        {Array.from({ length: n }, (_, segmentIndex) => (
          <span key={segmentIndex} className="inline-flex items-center gap-0.5">
            {n > 1 && (
              <span className="text-[10px] font-semibold tabular-nums text-slate-500">{segmentIndex + 1}</span>
            )}
            <CallLogRecordingPlayButton
              callLogId={callLogId}
              recordingIndex={segmentIndex}
              totalSegments={n}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

function inboundHistoryApiUrl(dateFrom: string, dateTo: string): string {
  const params = new URLSearchParams();
  if (dateFrom.trim()) params.set("dateFrom", dateFrom.trim());
  if (dateTo.trim()) params.set("dateTo", dateTo.trim());
  const q = params.toString();
  return q ? `/api/calls/inbound-history?${q}` : "/api/calls/inbound-history";
}

/** Aligns with server `listInboundCallHistory` (calendar days in APP_TIMEZONE). */
type InboundHistoryDatePreset = "recent" | "today" | "3d" | "7d" | "14d" | "30d" | "custom";

function ymdInShopTz(instant: Date, tz: string): string {
  const z = new TZDate(instant.getTime(), tz);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const d = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function presetToDateRange(
  preset: Exclude<InboundHistoryDatePreset, "recent" | "custom">,
  tz: string,
): { from: string; to: string } {
  const now = new TZDate(Date.now(), tz);
  const end = endOfDay(now);
  const todayStart = startOfDay(now);
  const to = ymdInShopTz(end, tz);
  if (preset === "today") {
    return { from: ymdInShopTz(todayStart, tz), to };
  }
  const daysBack = preset === "3d" ? 2 : preset === "7d" ? 6 : preset === "14d" ? 13 : 29;
  const fromDay = startOfDay(subDays(todayStart, daysBack));
  return { from: ymdInShopTz(fromDay, tz), to };
}

function detectPresetFromUrl(dateFrom: string, dateTo: string, tz: string): InboundHistoryDatePreset {
  const f = dateFrom.trim();
  const t = dateTo.trim();
  if (!f && !t) return "recent";
  const keys: Exclude<InboundHistoryDatePreset, "recent" | "custom">[] = [
    "today",
    "3d",
    "7d",
    "14d",
    "30d",
  ];
  for (const p of keys) {
    const r = presetToDateRange(p, tz);
    if (r.from === f && r.to === t) return p;
  }
  return "custom";
}

function normPhoneDigits(raw: string | null | undefined): string {
  let x = (raw ?? "").replace(/\D/g, "");
  if (x.length === 11 && x.startsWith("1")) x = x.slice(1);
  return x;
}

function dockLineMatchesRow(dock: ActiveDockCallSnapshot, row: InboundCallHistoryRowDto): boolean {
  const rd = normPhoneDigits(row.contactPhone);
  const dd = normPhoneDigits(dock.phoneDigits);
  if (!rd || !dd) return false;
  if (rd !== dd) return false;
  const dockOut = String(dock.direction ?? "").toUpperCase() === "OUTBOUND";
  const rowOut = row.direction === "OUTBOUND";
  return dockOut === rowOut;
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

type InboundCallHistoryTableProps = {
  initialRows: InboundCallHistoryRowDto[];
  /** `YYYY-MM-DD` from URL / server (shop timezone). */
  initialDateFrom?: string;
  initialDateTo?: string;
  dateFilterTimezone: string;
  canRunGeminiTranscribe?: boolean;
};

export function InboundCallHistoryTable({
  initialRows,
  initialDateFrom = "",
  initialDateTo = "",
  dateFilterTimezone,
  canRunGeminiTranscribe = false,
}: InboundCallHistoryTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlDateFrom = searchParams.get("dateFrom") ?? "";
  const urlDateTo = searchParams.get("dateTo") ?? "";

  const { liveUiSyncEnabled, activeCallPollSec, refreshIntervalSec, activeDockCalls } = useLiveUiSync();
  const [rows, setRows] = useState<InboundCallHistoryRowDto[]>(initialRows);
  const [dateFrom, setDateFrom] = useState(initialDateFrom || urlDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo || urlDateTo);
  const [preset, setPreset] = useState<InboundHistoryDatePreset>(() =>
    detectPresetFromUrl(initialDateFrom || urlDateFrom, initialDateTo || urlDateTo, dateFilterTimezone),
  );
  const fetchSeqRef = useRef(0);
  const [, setSuppressTick] = useState(0);

  useEffect(() => {
    setDateFrom(urlDateFrom);
    setDateTo(urlDateTo);
    setPreset(detectPresetFromUrl(urlDateFrom, urlDateTo, dateFilterTimezone));
  }, [urlDateFrom, urlDateTo, dateFilterTimezone]);

  const pollSec = refreshIntervalSec > 0 ? refreshIntervalSec : activeCallPollSec;
  const pollMs = Math.max(pollSec * 1000, 8000);

  const pushRangeToUrlAndFetch = useCallback(
    (from: string, to: string) => {
      const fi = from.trim();
      const te = to.trim();
      const params = new URLSearchParams();
      if (fi) params.set("dateFrom", fi);
      if (te) params.set("dateTo", te);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
      const seq = ++fetchSeqRef.current;
      void (async () => {
        try {
          const res = await fetch(inboundHistoryApiUrl(fi, te), { credentials: "include" });
          const data = (await res.json()) as { rows?: InboundCallHistoryRowDto[]; error?: string };
          if (!res.ok || !Array.isArray(data.rows)) return;
          if (seq !== fetchSeqRef.current) return;
          setRows(data.rows);
        } catch {
          /* keep */
        }
      })();
    },
    [pathname, router],
  );

  const fetchRows = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const res = await fetch(inboundHistoryApiUrl(dateFrom, dateTo), { credentials: "include" });
      const data = (await res.json()) as { rows?: InboundCallHistoryRowDto[]; error?: string };
      if (!res.ok || !Array.isArray(data.rows)) return;
      if (seq !== fetchSeqRef.current) return;
      setRows(data.rows);
    } catch {
      /* keep last good snapshot */
    }
  }, [dateFrom, dateTo]);

  const applyCustomRange = useCallback(() => {
    pushRangeToUrlAndFetch(dateFrom, dateTo);
  }, [dateFrom, dateTo, pushRangeToUrlAndFetch]);

  const handlePresetChange = useCallback(
    (val: InboundHistoryDatePreset) => {
      if (val === "recent") {
        pushRangeToUrlAndFetch("", "");
        return;
      }
      if (val === "custom") {
        setPreset("custom");
        return;
      }
      const r = presetToDateRange(val, dateFilterTimezone);
      pushRangeToUrlAndFetch(r.from, r.to);
    },
    [dateFilterTimezone, pushRangeToUrlAndFetch],
  );

  const clearDateFilter = useCallback(() => {
    handlePresetChange("recent");
  }, [handlePresetChange]);

  const onDateFromChangeWrapped = useCallback((v: string) => {
    setPreset("custom");
    setDateFrom(v);
  }, []);

  const onDateToChangeWrapped = useCallback((v: string) => {
    setPreset("custom");
    setDateTo(v);
  }, []);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  const dateFilterActive = Boolean(dateFrom.trim() || dateTo.trim());

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
    const synthetic = activeDockCalls
      .filter((d) => !rows.some((r) => dockLineMatchesRow(d, r)))
      .map((dock) => ({ kind: "synthetic" as const, dock }));
    const db = rows.map((row) => ({ kind: "db" as const, row }));
    return [...synthetic, ...db];
  }, [rows, activeDockCalls]);

  const shownCount = merged.length;
  const countNoun = shownCount === 1 ? "call" : "calls";

  if (merged.length === 0) {
    return (
      <div className="space-y-4">
        <DateFilterBar
          preset={preset}
          onPresetChange={handlePresetChange}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={onDateFromChangeWrapped}
          onDateToChange={onDateToChangeWrapped}
          onApplyCustom={applyCustomRange}
          onClear={clearDateFilter}
          timezoneLabel={dateFilterTimezone}
          filterActive={dateFilterActive}
        />
        <p className="text-sm text-slate-600">
          <span className="font-semibold tabular-nums text-slate-800">{shownCount}</span> {countNoun} shown
          <span className="text-slate-400"> · </span>
          {dateFilterActive ? "No calls in this range." : "No calls on file yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DateFilterBar
        preset={preset}
        onPresetChange={handlePresetChange}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={onDateFromChangeWrapped}
        onDateToChange={onDateToChangeWrapped}
        onApplyCustom={applyCustomRange}
        onClear={clearDateFilter}
        timezoneLabel={dateFilterTimezone}
        filterActive={dateFilterActive}
      />
      <p className="text-sm text-slate-600" aria-live="polite">
        <span className="font-semibold tabular-nums text-slate-800">{shownCount}</span> {countNoun} shown
      </p>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[940px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="w-10 py-3 pr-2 text-center" scope="col">
              <span className="sr-only">Call type</span>
            </th>
            <th className="py-3 pr-4">When</th>
            <th className="py-3 pr-3">Result</th>
            <th className="py-3 pr-3">Length</th>
            <th className="py-3 pr-3">Rec</th>
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
              const liveOut = String(dock.direction ?? "").toUpperCase() === "OUTBOUND";
              const finishing = dock.livePhase === "finishing";
              return (
                <tr
                  key={`dock-live:${dock.key}`}
                  className={`border-b border-slate-100 last:border-0 ${finishing ? "bg-amber-50/50" : "bg-emerald-50/40"}`}
                >
                  <td className="py-3 pr-2 align-top text-center text-slate-700">
                    <InboundCallTypeIcon direction={liveOut ? "OUTBOUND" : "INBOUND"} telephonyResult={null} />
                  </td>
                  <td className="py-3 pr-4 align-top text-slate-700">
                    <span className={`font-medium ${finishing ? "text-amber-900" : "text-emerald-800"}`}>
                      {finishing ? "Finishing call" : "Live now"}
                    </span>
                  </td>
                  <td className="py-3 pr-3 align-top text-slate-400">—</td>
                  <td className="py-3 pr-3 align-top text-slate-400">—</td>
                  <td className="py-3 pr-3 align-top text-slate-400">—</td>
                  <td className="py-3 pr-4 align-top font-medium text-slate-500">—</td>
                  <td className="py-3 pr-4 align-top text-slate-700">{dock.callerName?.trim() || "—"}</td>
                  <td className="py-3 pr-4 align-top text-slate-700">{dock.phoneDisplay}</td>
                  <td className="max-w-xs py-3 pr-4 align-top text-slate-600">
                    <span className="line-clamp-2">
                      {finishing
                        ? "The carrier ended this session on one leg; we wait briefly before creating the call log so hunt groups and forwards are not saved as missed."
                        : liveOut
                          ? "Outgoing call in progress — open the log from the dock or here. This row disappears when the line clears."
                          : "Incoming call in progress — open the log from the dock or here. This row disappears when the line clears."}
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
                <td className="py-3 pr-2 align-top text-center text-slate-700">
                  <InboundCallTypeIcon direction={row.direction} telephonyResult={row.telephonyResult} />
                </td>
                <td className="py-3 pr-4 align-top text-slate-700">
                  {formatWhenInShopTz(row.happenedAt, dateFilterTimezone)}
                </td>
                <td className="max-w-[140px] py-3 pr-3 align-top text-slate-700">
                  <span className="line-clamp-2 text-sm" title={row.telephonyResult ?? undefined}>
                    {row.telephonyResult?.trim() || "—"}
                  </span>
                </td>
                <td className="py-3 pr-3 align-top tabular-nums text-slate-700">
                  {formatInboundCallHistoryDuration(row.durationSeconds ?? null)}
                </td>
                <td className="py-3 pr-3 align-top text-center text-slate-800">
                  <InboundHistoryRecordingCell callLogId={row.id} recordingCount={row.recordingCount ?? 0} />
                </td>
                <td className="py-3 pr-4 align-top font-medium text-slate-900">
                  {row.clientId ? (
                    <Link
                      href={`/clients/${row.clientId}`}
                      className="text-[#1e5ea8] hover:text-[#17497f] hover:underline"
                    >
                      {row.clientDisplayName}
                    </Link>
                  ) : (
                    <span className="text-slate-600">{row.clientDisplayName}</span>
                  )}
                </td>
                <td className="py-3 pr-4 align-top text-slate-700">{row.contactName?.trim() || "—"}</td>
                <td className="py-3 pr-4 align-top text-slate-700">{row.contactPhone?.trim() || "—"}</td>
                <td className="max-w-xs py-3 pr-4 align-top text-slate-600">
                  <InboundHistorySummaryCell
                    row={row}
                    canRunGeminiTranscribe={canRunGeminiTranscribe}
                    refetch={fetchRows}
                  />
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
    </div>
  );
}

function DateFilterBar({
  preset,
  onPresetChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onApplyCustom,
  onClear,
  timezoneLabel,
  filterActive,
}: {
  preset: InboundHistoryDatePreset;
  onPresetChange: (p: InboundHistoryDatePreset) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onApplyCustom: () => void;
  onClear: () => void;
  timezoneLabel: string;
  filterActive: boolean;
}) {
  const showCustom = preset === "custom";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex w-full min-w-0 flex-col gap-3 sm:w-auto">
        <label className="flex max-w-xs flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Range</span>
          <select
            value={preset}
            onChange={(e) => onPresetChange(e.target.value as InboundHistoryDatePreset)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm"
          >
            <option value="recent">Latest calls (default)</option>
            <option value="today">Today</option>
            <option value="3d">Last 3 days</option>
            <option value="7d">Last 7 days</option>
            <option value="14d">Last 2 weeks</option>
            <option value="30d">Last 30 days</option>
            <option value="custom">Custom…</option>
          </select>
        </label>
        {showCustom ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => onDateFromChange(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => onDateToChange(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm"
              />
            </label>
            <button
              type="button"
              onClick={onApplyCustom}
              className="rounded-xl bg-[#1e5ea8] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#17497f]"
            >
              Apply
            </button>
          </div>
        ) : null}
        {filterActive ? (
          <button
            type="button"
            onClick={onClear}
            className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Clear
          </button>
        ) : null}
      </div>
      <p className="text-[11px] leading-snug text-slate-500 sm:ml-auto sm:max-w-[280px] sm:text-right">
        Presets use calendar days in <span className="font-medium text-slate-600">{timezoneLabel}</span>, ending today.
        Choose Custom to pick exact From/To dates. Latest calls leaves the range open (default list).
      </p>
    </div>
  );
}
