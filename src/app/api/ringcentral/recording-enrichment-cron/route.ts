import { NextResponse, type NextRequest } from "next/server";

import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { runTelephonyRecordingEnrichmentCron } from "@/lib/ringcentral/recording-enrichment-cron";

/** Numeric literal for Next.js segment config; align with Vercel function max duration (Pro max 800). */
export const maxDuration = 800;

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

async function parseLimit(req: NextRequest): Promise<number> {
  let limit = 25;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object" && body !== null && "limit" in body) {
        const n = Number((body as { limit: unknown }).limit);
        if (Number.isFinite(n) && n > 0) limit = n;
      }
    } else {
      const q = req.nextUrl.searchParams.get("limit");
      if (q) {
        const n = Number(q);
        if (Number.isFinite(n) && n > 0) limit = n;
      }
    }
  } catch {
    /* ignore */
  }
  return Math.min(Math.max(Math.floor(limit), 1), 80);
}

async function handle(req: NextRequest) {
  if (!cronSecret()) {
    return NextResponse.json(
      {
        error:
          "Cron is not configured. Set CRON_SECRET (or RINGCENTRAL_SYNC_CRON_SECRET) in the environment — same as sync-cron.",
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

  const limit = await parseLimit(req);
  try {
    const result = await runTelephonyRecordingEnrichmentCron({ limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Recording enrichment failed.";
    console.error("[recording-enrichment-cron]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
