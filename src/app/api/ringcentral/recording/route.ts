import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { getSupabaseAdmin, tables } from "@/lib/db";
import { getRingCentralPlatform } from "@/lib/ringcentral/platform";
import { getUserCapabilities } from "@/lib/user-privileges";

export async function GET(req: NextRequest) {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canViewClients) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const callLogId = req.nextUrl.searchParams.get("callLogId")?.trim() ?? "";
  if (!callLogId) {
    return NextResponse.json({ error: "callLogId is required." }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data: row, error } = await sb
    .from(tables.CallLog)
    .select("id,telephonyRecordingContentUri")
    .eq("id", callLogId)
    .maybeSingle();
  if (error) throw error;
  const uri = String((row?.telephonyRecordingContentUri as string | undefined) ?? "").trim();
  if (!row || !uri) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const platform = await getRingCentralPlatform();
  const range = req.headers.get("range");
  const rcResp = await platform.get(uri, undefined, range ? { headers: { Range: range } } : undefined);
  if (!rcResp.ok) {
    const text = await rcResp.text().catch(() => "");
    return NextResponse.json(
      { error: `RingCentral returned ${rcResp.status}`, detail: text.slice(0, 200) },
      { status: 502 },
    );
  }

  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag"] as const) {
    const v = rcResp.headers.get(name);
    if (v) headers.set(name, v);
  }
  if (!headers.has("content-type")) {
    headers.set("Content-Type", "audio/mpeg");
  }
  const cache = rcResp.headers.get("cache-control");
  if (cache) headers.set("Cache-Control", cache);

  return new NextResponse(rcResp.body, { status: rcResp.status, headers });
}
