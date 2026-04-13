import type { NextRequest } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { jsonPrivate } from "@/lib/api-private-json";
import {
  isCallHistoryOpenLogDisabled,
  listInboundCallHistory,
  resolveInboundCallHistoryHappenedAtRange,
  type InboundCallHistoryDateFilter,
} from "@/lib/crm";
import type { InboundCallHistoryRowDto } from "@/lib/inbound-call-history-dto";
import { getUserCapabilities } from "@/lib/user-privileges";

/**
 * JSON snapshot for the Call history table. Used by client polling so the list
 * updates without relying on RSC `router.refresh()` caching behavior.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUserForApi();
  if (!user) {
    return jsonPrivate({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canViewCallsSection) {
    return jsonPrivate({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const dateFrom = sp.get("dateFrom")?.trim() || undefined;
  const dateTo = sp.get("dateTo")?.trim() || undefined;
  const filter: InboundCallHistoryDateFilter | null =
    dateFrom || dateTo ? { dateFrom: dateFrom ?? null, dateTo: dateTo ?? null } : null;
  if (filter && resolveInboundCallHistoryHappenedAtRange(filter) === null) {
    return jsonPrivate(
      {
        error: "Invalid dateFrom or dateTo. Use YYYY-MM-DD (shop timezone). From must be on or before To.",
      },
      { status: 400 },
    );
  }

  try {
    const rows = await listInboundCallHistory(filter);
    const payload: InboundCallHistoryRowDto[] = rows.map((r) => ({
      id: r.id,
      direction: r.direction,
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

    return jsonPrivate({ rows: payload });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load call history.";
    return jsonPrivate({ error: message }, { status: 500 });
  }
}
