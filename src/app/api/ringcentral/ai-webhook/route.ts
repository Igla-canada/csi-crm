import { NextResponse, type NextRequest } from "next/server";

import { applyRingCentralAiWebhookPayload } from "@/lib/crm";
import { getRingCentralWebhookSecret } from "@/lib/ringcentral/env";

export async function POST(req: NextRequest) {
  const secret = getRingCentralWebhookSecret();
  if (secret != null) {
    const token = req.nextUrl.searchParams.get("token") ?? "";
    if (token !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const { updated } = await applyRingCentralAiWebhookPayload(body);
    return NextResponse.json({ ok: true, updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Webhook failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
