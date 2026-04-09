import { getCurrentUserForApi } from "@/lib/auth";
import { jsonPrivate } from "@/lib/api-private-json";
import { isCallHistoryOpenLogDisabled, listInboundCallHistory } from "@/lib/crm";
import type { InboundCallHistoryRowDto } from "@/lib/inbound-call-history-dto";
import { getUserCapabilities } from "@/lib/user-privileges";

/**
 * JSON snapshot for the Call history table. Used by client polling so the list
 * updates without relying on RSC `router.refresh()` caching behavior.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUserForApi();
  if (!user) {
    return jsonPrivate({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canViewCallsSection) {
    return jsonPrivate({ error: "Forbidden" }, { status: 403 });
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

    return jsonPrivate({ rows: payload });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load call history.";
    return jsonPrivate({ error: message }, { status: 500 });
  }
}
