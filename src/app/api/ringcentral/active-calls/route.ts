import { NextResponse } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { parseExtensionActiveCallsFailure } from "@/lib/ringcentral/active-calls-error";
import {
  type ExtensionActiveCallSummary,
  fetchExtensionActiveCallsWithMeta,
} from "@/lib/ringcentral/fetch-extension-active-calls";
import { getExtensionActiveCallsPollPlan, isRingCentralConfigured } from "@/lib/ringcentral/env";
import { listTelephonyLiveSessionsForDock } from "@/lib/ringcentral/telephony-live-sessions";
import { telephonyLiveRowsToDockSummaries } from "@/lib/ringcentral/telephony-session-notify";
import { getUserCapabilities } from "@/lib/user-privileges";

function mergeDockCalls(
  poll: ExtensionActiveCallSummary[],
  webhook: ExtensionActiveCallSummary[],
): ExtensionActiveCallSummary[] {
  const map = new Map<string, ExtensionActiveCallSummary>();
  for (const x of poll) {
    map.set(x.key, x);
  }
  for (const x of webhook) {
    map.set(x.key, x);
  }
  return [...map.values()];
}

export async function GET() {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canViewCallsSection) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isRingCentralConfigured()) {
    return NextResponse.json({ ok: true, configured: false, calls: [] as const });
  }

  let webhookCalls: ExtensionActiveCallSummary[] = [];
  try {
    const rows = await listTelephonyLiveSessionsForDock();
    webhookCalls = telephonyLiveRowsToDockSummaries(rows);
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[active-calls] TelephonyLiveSession read failed (run DB migration?):", e);
    }
  }

  const skipExtensionActiveCallsPoll = process.env.RINGCENTRAL_SKIP_EXTENSION_ACTIVE_CALLS === "true";
  let pollCalls: ExtensionActiveCallSummary[] = [];
  let extensionApiRecordCount: number | null = null;
  let extensionSkippedEnded = 0;
  let extensionPollTarget = getExtensionActiveCallsPollPlan().describeTarget;
  let pollMessage: string | null = null;
  let dockExtensionPollRateLimited = false;

  if (!skipExtensionActiveCallsPoll) {
    try {
      const ext = await fetchExtensionActiveCallsWithMeta();
      pollCalls = ext.summaries;
      extensionApiRecordCount = ext.rawRecordCount;
      extensionSkippedEnded = ext.skippedEnded;
      extensionPollTarget = ext.pollTargetDescription;
      dockExtensionPollRateLimited = ext.extensionPollRateLimited === true;
    } catch (e) {
      pollMessage = e instanceof Error ? e.message : "RingCentral active-calls failed.";
    }
  }

  const calls = mergeDockCalls(pollCalls, webhookCalls);

  const extensionDiag = {
    /** How many rows RingCentral returned before we map/filter (null if extension poll skipped or errored). */
    extensionApiRecordCount,
    extensionSkippedEnded,
    extensionPollTarget,
    ...(dockExtensionPollRateLimited ? { dockExtensionPollRateLimited: true as const } : {}),
  };

  if (calls.length > 0) {
    return NextResponse.json({
      ok: true,
      configured: true,
      calls,
      webhookSessions: webhookCalls.length,
      extensionPollSessions: pollCalls.length,
      skipExtensionActiveCallsPoll,
      ...extensionDiag,
    });
  }

  if (pollMessage) {
    const { upstreamStatus, rateLimited, extensionIdNotFound } = parseExtensionActiveCallsFailure(pollMessage);

    if (process.env.NODE_ENV === "development") {
      console.warn("[active-calls] RingCentral error:", {
        upstreamStatus,
        rateLimited,
        extensionIdNotFound,
        message: pollMessage.slice(0, 500),
      });
    }

    let httpStatus = 502;
    if (extensionIdNotFound) {
      httpStatus = 400;
    } else if (rateLimited) {
      httpStatus = 429;
    } else if (upstreamStatus === 403) {
      httpStatus = 403;
    } else if (upstreamStatus === 401) {
      httpStatus = 401;
    } else if (upstreamStatus === 404) {
      httpStatus = 404;
    }

    let error = pollMessage;
    if (extensionIdNotFound) {
      error =
        "RINGCENTRAL_ACTIVE_CALLS_EXTENSION_ID is wrong for this account/JWT. RingCentral says that extension id does not exist or is not visible to this app. Remove the variable from .env to use the JWT default extension (~), or set it to the exact numeric \"id\" from GET /restapi/v1.0/account/~/extension for the user who receives calls (not the Telus phone/device page URL id). Extension number (e.g. 102) often does not work in this path.";
    } else if (upstreamStatus === 403) {
      error =
        "RingCentral returned 403 — the JWT app needs telephony/call-log permissions. For the live dock, prefer registering the account telephony webhook in Workspace → RingCentral.";
    } else if (upstreamStatus === 401) {
      error =
        "RingCentral returned 401 — JWT may be expired or invalid. Regenerate RINGCENTRAL_JWT in the developer console.";
    }

    return NextResponse.json(
      {
        ok: false,
        configured: true,
        error,
        calls: [] as const,
        skipExtensionActiveCallsPoll,
        webhookSessions: webhookCalls.length,
        extensionPollSessions: pollCalls.length,
        ...extensionDiag,
        ...(upstreamStatus != null ? { upstreamStatus } : {}),
      },
      { status: httpStatus },
    );
  }

  const emptyHint =
    extensionApiRecordCount === 0 &&
    webhookCalls.length === 0 &&
    !skipExtensionActiveCallsPoll &&
    !dockExtensionPollRateLimited
      ? "RingCentral returned 0 extension active-call rows for this poll target. Either: (1) set RINGCENTRAL_ACTIVE_CALLS_EXTENSION_ID in .env to the numeric extension id of the line that actually rings (Admin → Users → extension id), restart dev; (2) register account telephony webhooks so webhookSessions > 0; or (3) use a JWT for the same extension that receives calls."
      : extensionApiRecordCount != null &&
          extensionApiRecordCount > 0 &&
          pollCalls.length === 0 &&
          !skipExtensionActiveCallsPoll
        ? "RingCentral returned active-call rows but all were filtered (e.g. ended status). If this persists during a live call, share a redacted API sample."
        : null;

  return NextResponse.json({
    ok: true,
    configured: true,
    calls: [] as const,
    webhookSessions: webhookCalls.length,
    extensionPollSessions: pollCalls.length,
    skipExtensionActiveCallsPoll,
    ...extensionDiag,
    ...(emptyHint ? { dockEmptyHint: emptyHint } : {}),
  });
}
