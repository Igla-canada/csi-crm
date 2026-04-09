import { NextResponse } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { isCallHistoryOpenLogDisabled, listInboundCallHistory } from "@/lib/crm";
import type { InboundCallHistoryRowDto } from "@/lib/inbound-call-history-dto";
import { getUserCapabilities } from "@/lib/user-privileges";

/**
 * JSON snapshot for the Call history table. Used by client polling so the list
 * updates without relying on RSC `router.refresh()` caching behavior.
 */
export async function GET() {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canViewCallsSection) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rows = await listInboundCallHistory();
    const payload: InboundCallHistoryRowDto[] = rows.map((r) => ({
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

    return NextResponse.json(
      { rows: payload },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load call history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
