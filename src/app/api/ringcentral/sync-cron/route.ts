import { NextResponse, type NextRequest } from "next/server";

import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { syncRingCentralVoiceCallLogsFromApi } from "@/lib/ringcentral/sync-call-logs";

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

async function parseHoursBack(req: NextRequest): Promise<number> {
  let hoursBack = 6;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object" && body !== null && "hoursBack" in body) {
        const n = Number((body as { hoursBack: unknown }).hoursBack);
        if (Number.isFinite(n) && n > 0) hoursBack = n;
      }
    } else {
      const q = req.nextUrl.searchParams.get("hoursBack");
      if (q) {
        const n = Number(q);
        if (Number.isFinite(n) && n > 0) hoursBack = n;
      }
    }
  } catch {
    /* ignore */
  }
  return Math.min(Math.max(hoursBack, 1), 168);
}

async function handle(req: NextRequest) {
  if (!cronSecret()) {
    return NextResponse.json(
      {
        error:
          "Cron sync is not configured. Set CRON_SECRET (or RINGCENTRAL_SYNC_CRON_SECRET) in the environment.",
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

  const hoursBack = await parseHoursBack(req);

  try {
    const result = await syncRingCentralVoiceCallLogsFromApi({ hoursBack });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
