import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";

import {
  applyRingCentralTelephonyWebhookBody,
  finalizeDeferredTelephonySessionEnd,
} from "@/lib/ringcentral/telephony-session-notify";
import { VERCEL_NODE_MAX_DURATION_SECONDS } from "@/lib/vercel-node-max-duration";

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const dynamic = "force-dynamic";
export const maxDuration = VERCEL_NODE_MAX_DURATION_SECONDS;

/**
 * Probes (browser, ngrok, uptime checks) often GET the webhook URL. RingCentral itself delivers notifications via POST.
 */
export async function GET() {
  return new NextResponse("OK — RingCentral telephony session notifications are POSTed to this URL.", {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/**
 * Inbound-only: RingCentral pushes telephony session **notifications** here. We parse and mirror state into our DB for
 * the live dock. We do not call RingCentral back to control calls (read-only observation).
 * Must be reachable at a public HTTPS URL. On subscription setup, RingCentral sends `Validation-Token`; echo it in the response header.
 */
export async function POST(req: NextRequest) {
  const validation = req.headers.get("validation-token");
  if (validation) {
    return new NextResponse(null, {
      status: 200,
      headers: { "Validation-Token": validation },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const { processed, payloadsSeen, recordingRefreshJobs, sessionFinalizeJobs } =
      await applyRingCentralTelephonyWebhookBody(body);
    for (const job of sessionFinalizeJobs) {
      after(async () => {
        await sleepMs(job.delayMs);
        try {
          const { recordingRefreshJobs: postFinalizeRecording } = await finalizeDeferredTelephonySessionEnd(
            job.sessionId,
            job.token,
          );
          for (const rj of postFinalizeRecording) {
            after(async () => {
              await sleepMs(rj.delayMs);
              try {
                const { syncSingleRingCentralCallLogByCrmId } = await import("@/lib/ringcentral/sync-call-logs");
                const result = await syncSingleRingCentralCallLogByCrmId(rj.callLogId);
                if (!result.ok && process.env.NODE_ENV === "development") {
                  console.info("[telephony-webhook] deferred recording refresh:", rj.callLogId, result.error);
                }
              } catch (e) {
                console.warn("[telephony-webhook] deferred recording refresh failed:", e);
              }
            });
          }
        } catch (e) {
          console.warn("[telephony-webhook] deferred session finalize failed:", e);
        }
      });
    }
    for (const job of recordingRefreshJobs) {
      after(async () => {
        await sleepMs(job.delayMs);
        try {
          const { syncSingleRingCentralCallLogByCrmId } = await import("@/lib/ringcentral/sync-call-logs");
          const result = await syncSingleRingCentralCallLogByCrmId(job.callLogId);
          if (!result.ok && process.env.NODE_ENV === "development") {
            console.info("[telephony-webhook] deferred recording refresh:", job.callLogId, result.error);
          }
        } catch (e) {
          console.warn("[telephony-webhook] deferred recording refresh failed:", e);
        }
      });
    }
    if (payloadsSeen === 0) {
      const keys = body && typeof body === "object" ? Object.keys(body as object) : [];
      const snippet = JSON.stringify(body).slice(0, 1200);
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[telephony-webhook] No session payloads parsed (RingCentral shape may differ). Top-level keys:",
          keys,
          "snippet:",
          snippet,
        );
      } else if (keys.length > 0) {
        // Production: RingCentral reached us but parser found no sessions — check Vercel logs and telephony-debug.
        console.warn("[telephony-webhook] No session payloads parsed; keys:", keys.join(","), "snippet:", snippet);
      }
    }
    return NextResponse.json(
      { ok: true, processed, payloadsSeen },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Webhook handler failed.";
    if (process.env.NODE_ENV === "development") {
      console.warn("[telephony-webhook]", message);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
