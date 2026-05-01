import { NextResponse, type NextRequest } from "next/server";

import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { renewOrEnsureAccountTelephonyWebhook } from "@/lib/ringcentral/telephony-subscription";

/** RingCentral subscription renew is quick; align with other small cron handlers. */
export const maxDuration = 120;

function cronSecret(): string | null {
  const a = process.env.CRON_SECRET?.trim();
  const b = process.env.RINGCENTRAL_SYNC_CRON_SECRET?.trim();
  return a || b || null;
}

function authorized(req: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = req.nextUrl.searchParams.get("secret");
  if (q === secret) return true;
  return false;
}

async function handle(req: NextRequest) {
  if (!cronSecret()) {
    return NextResponse.json(
      {
        error:
          "Cron is not configured. Set CRON_SECRET (or RINGCENTRAL_SYNC_CRON_SECRET) — Vercel injects it as Authorization: Bearer on scheduled runs.",
      },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isRingCentralConfigured()) {
    return NextResponse.json({ error: "RingCentral is not configured." }, { status: 400 });
  }

  try {
    const result = await renewOrEnsureAccountTelephonyWebhook();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Telephony webhook renew failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
