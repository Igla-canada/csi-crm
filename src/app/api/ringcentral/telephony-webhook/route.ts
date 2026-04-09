import { NextResponse, type NextRequest } from "next/server";

import { applyRingCentralTelephonyWebhookBody } from "@/lib/ringcentral/telephony-session-notify";

export const dynamic = "force-dynamic";

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
    const { processed, payloadsSeen } = await applyRingCentralTelephonyWebhookBody(body);
    if (process.env.NODE_ENV === "development" && payloadsSeen === 0) {
      const keys = body && typeof body === "object" ? Object.keys(body as object) : [];
      console.warn(
        "[telephony-webhook] No session payloads parsed (RingCentral shape may differ). Top-level keys:",
        keys,
        "snippet:",
        JSON.stringify(body).slice(0, 1200),
      );
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
