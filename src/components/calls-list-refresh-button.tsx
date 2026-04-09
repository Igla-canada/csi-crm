"use client";

import { useRouter } from "next/navigation";

import { INBOUND_CALL_HISTORY_REFRESH_EVENT } from "@/lib/call-history-refresh-event";

/** Triggers client fetch of `/api/calls/inbound-history` plus RSC refresh. */
export function CallsListRefreshButton() {
  const router = useRouter();
  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new Event(INBOUND_CALL_HISTORY_REFRESH_EVENT));
          router.refresh();
        }}
        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        Refresh list
      </button>
      <p className="max-w-[240px] text-right text-[11px] leading-snug text-slate-500">
        Fetches the latest rows from the database. New RingCentral calls only appear after sync imports them (cron or
        Workspace → RingCentral).
      </p>
    </div>
  );
}
