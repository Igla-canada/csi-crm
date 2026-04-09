import { NextResponse } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { subscribeAccountTelephonyWebhooks } from "@/lib/ringcentral/telephony-subscription";
import { getUserCapabilities } from "@/lib/user-privileges";

export async function POST() {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canConfigure) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isRingCentralConfigured()) {
    return NextResponse.json({ error: "RingCentral is not configured." }, { status: 400 });
  }

  try {
    const subscription = await subscribeAccountTelephonyWebhooks();
    return NextResponse.json({ ok: true, subscription });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Subscription failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
