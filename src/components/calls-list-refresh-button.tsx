"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { INBOUND_CALL_HISTORY_REFRESH_EVENT } from "@/lib/call-history-refresh-event";

/** Syncs RingCentral into the DB for the current URL date filter, then refetches inbound history. */
export function CallsListRefreshButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void (async () => {
            setError(null);
            setSyncInfo(null);
            setPending(true);
            try {
              const dateFrom = searchParams.get("dateFrom")?.trim() ?? "";
              const dateTo = searchParams.get("dateTo")?.trim() ?? "";
              const res = await fetch("/api/calls/inbound-history/ringcentral-sync", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...(dateFrom ? { dateFrom } : {}),
                  ...(dateTo ? { dateTo } : {}),
                }),
              });
              const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
              if (!res.ok) {
                const msg =
                  (typeof data?.error === "string" && data.error) || `Sync failed (${res.status}).`;
                setError(msg);
                return;
              }
              const skipped = typeof data?.skipped === "number" ? data.skipped : 0;
              if (skipped > 0) {
                setSyncInfo(
                  `Synced, but ${skipped} RingCentral row(s) were skipped. In DevTools → Network, open this response and inspect skippedSamples (RingCentral ids + reason).`,
                );
              }
              window.dispatchEvent(new Event(INBOUND_CALL_HISTORY_REFRESH_EVENT));
              router.refresh();
            } catch {
              setError("Network error.");
            } finally {
              setPending(false);
            }
          })();
        }}
        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Syncing…" : "Refresh list"}
      </button>
      {error ? (
        <p className="max-w-[260px] text-right text-[11px] leading-snug text-red-600" role="alert">
          {error}
        </p>
      ) : syncInfo ? (
        <p className="max-w-[280px] text-right text-[11px] leading-snug text-amber-800" role="status">
          {syncInfo}
        </p>
      ) : (
        <p className="max-w-[260px] text-right text-[11px] leading-snug text-slate-500">
          Pulls voice call logs from RingCentral for the current range (same calendar days as the filter, or up to the
          last 7 days when &quot;Latest calls&quot;), updates the database, then reloads this list.
        </p>
      )}
    </div>
  );
}
