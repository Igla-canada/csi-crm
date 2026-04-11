import { Suspense } from "react";
import { redirect } from "next/navigation";

import { Card, SectionHeading } from "@/components/app-shell";
import { CallsListRefreshButton } from "@/components/calls-list-refresh-button";
import { InboundCallHistoryTable } from "@/components/inbound-call-history-table";
import { getCurrentUser } from "@/lib/auth";
import {
  isCallHistoryOpenLogDisabled,
  listInboundCallHistory,
  resolveInboundCallHistoryHappenedAtRange,
  type InboundCallHistoryDateFilter,
} from "@/lib/crm";
import type { InboundCallHistoryRowDto } from "@/lib/inbound-call-history-dto";
import { getAppTimezone } from "@/lib/google-calendar/env";
import { getUserCapabilities } from "@/lib/user-privileges";

export const dynamic = "force-dynamic";

export default async function CallHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ dateFrom?: string; dateTo?: string }>;
}) {
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  if (!caps.canViewCallsSection) {
    redirect("/");
  }

  const sp = await searchParams;
  const rawFrom = typeof sp.dateFrom === "string" ? sp.dateFrom : undefined;
  const rawTo = typeof sp.dateTo === "string" ? sp.dateTo : undefined;
  const filter: InboundCallHistoryDateFilter | null =
    rawFrom || rawTo ? { dateFrom: rawFrom ?? null, dateTo: rawTo ?? null } : null;
  const effectiveFilter =
    filter && resolveInboundCallHistoryHappenedAtRange(filter) != null ? filter : null;

  const rows = await listInboundCallHistory(effectiveFilter);
  const initialRows: InboundCallHistoryRowDto[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientDisplayName: r.clientDisplayName,
    contactPhone: r.contactPhone,
    contactName: r.contactName,
    happenedAt: r.happenedAt.toISOString(),
    telephonyDraft: r.telephonyDraft,
    summary: r.summary,
    displaySummary: r.displaySummary,
    hasTranscription: r.hasTranscription,
    geminiTranscribePending: r.geminiTranscribePending,
    rcAiTranscribePending: r.rcAiTranscribePending,
    openedFromCallHistoryAt: r.openedFromCallHistoryAt?.toISOString() ?? null,
    ringCentralCallLogId: r.ringCentralCallLogId,
    telephonyResult: r.telephonyResult,
    durationSeconds: r.durationSeconds,
    recordingCount: r.recordingCount,
    openLogDisabled:
      !caps.canLogCalls ||
      isCallHistoryOpenLogDisabled({
        openedFromCallHistoryAt: r.openedFromCallHistoryAt,
        telephonyDraft: r.telephonyDraft,
        summary: r.summary,
        ringCentralCallLogId: r.ringCentralCallLogId,
      }),
  }));

  return (
    <div className="crm-grid">
      <SectionHeading
        eyebrow="Calls"
        title="Inbound call history"
        text="Newest first — like a phone recents list. With Live sync on, this list re-fetches from the database on the same interval as the header. Refresh list pulls RingCentral for the selected range (or up to the last 7 days when no range), then reloads. TELUS detailed logs may list each leg separately; we show one row per RingCentral call, with result, length, and recording count when the platform provides them. Open log completes the stub on the client."
        aside={
          <Suspense
            fallback={
              <div className="h-10 w-[7.5rem] animate-pulse rounded-xl bg-slate-100" aria-hidden />
            }
          >
            <CallsListRefreshButton />
          </Suspense>
        }
      />

      <Card>
        <Suspense
          fallback={<p className="px-2 py-8 text-center text-sm text-slate-600">Loading call history…</p>}
        >
          <InboundCallHistoryTable
            initialRows={initialRows}
            initialDateFrom={effectiveFilter?.dateFrom?.trim() ?? ""}
            initialDateTo={effectiveFilter?.dateTo?.trim() ?? ""}
            dateFilterTimezone={getAppTimezone()}
            canRunGeminiTranscribe={caps.canConfigure || caps.canEditCallLogs}
          />
        </Suspense>
      </Card>
    </div>
  );
}
