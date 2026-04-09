import { redirect } from "next/navigation";

import { Card, SectionHeading } from "@/components/app-shell";
import { CallsListRefreshButton } from "@/components/calls-list-refresh-button";
import { InboundCallHistoryTable } from "@/components/inbound-call-history-table";
import { getCurrentUser } from "@/lib/auth";
import { isCallHistoryOpenLogDisabled, listInboundCallHistory } from "@/lib/crm";
import type { InboundCallHistoryRowDto } from "@/lib/inbound-call-history-dto";
import { getUserCapabilities } from "@/lib/user-privileges";

export const dynamic = "force-dynamic";

export default async function CallHistoryPage() {
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  if (!caps.canViewCallsSection) {
    redirect("/");
  }

  const rows = await listInboundCallHistory();
  const initialRows: InboundCallHistoryRowDto[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientDisplayName: r.clientDisplayName,
    contactPhone: r.contactPhone,
    contactName: r.contactName,
    happenedAt: r.happenedAt.toISOString(),
    telephonyDraft: r.telephonyDraft,
    summary: r.summary,
    openedFromCallHistoryAt: r.openedFromCallHistoryAt?.toISOString() ?? null,
    ringCentralCallLogId: r.ringCentralCallLogId,
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
        text="Newest first — like a phone recents list. With Live sync on, this list re-fetches from the database on the same interval as the header (it does not pull RingCentral by itself; new calls appear after sync imports them). Use Open log to jump to the client and complete a RingCentral stub, or review a manual inbound log once."
        aside={<CallsListRefreshButton />}
      />

      <Card>
        <InboundCallHistoryTable initialRows={initialRows} />
      </Card>
    </div>
  );
}
