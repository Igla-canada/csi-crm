import "server-only";

import { getAppPublicUrl } from "@/lib/ringcentral/env";
import { getRingCentralPlatform } from "@/lib/ringcentral/platform";

const TELEPHONY_FILTER = "/restapi/v1.0/account/~/telephony/sessions";

/**
 * Register (or replace) an account-level **notification** subscription so RingCentral POSTs session updates to our
 * webhook. This is listen-only: we never invoke RingCentral call-control APIs (answer, hang up, transfer, etc.).
 * Requires RingCentral app permission to **receive** telephony session events (wording varies in the developer portal).
 */
export async function subscribeAccountTelephonyWebhooks(): Promise<Record<string, unknown>> {
  const base = getAppPublicUrl();
  if (!base) {
    throw new Error(
      "APP_URL is not set. RingCentral must reach your server over HTTPS (use ngrok or similar for local dev).",
    );
  }
  const address = `${base}/api/ringcentral/telephony-webhook`;
  const platform = await getRingCentralPlatform();
  const body = {
    eventFilters: [TELEPHONY_FILTER],
    deliveryMode: {
      transportType: "WebHook",
      address,
    },
  };
  const res = await platform.post("/restapi/v1.0/subscription", body);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RingCentral subscription failed (${res.status}): ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`RingCentral subscription returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export type RingCentralSubscriptionDebugRow = {
  id: string;
  status: string | null;
  expirationTime: string | null;
  eventFilters: string[];
  webhookAddress: string | null;
  transportType: string | null;
};

function parseSubscriptionRecord(r: unknown): RingCentralSubscriptionDebugRow | null {
  if (!r || typeof r !== "object") return null;
  const row = r as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  const dm = row.deliveryMode;
  let webhookAddress: string | null = null;
  let transportType: string | null = null;
  if (dm && typeof dm === "object") {
    const d = dm as Record<string, unknown>;
    webhookAddress = String(d.address ?? "").trim() || null;
    transportType = String(d.transportType ?? "").trim() || null;
  }
  const filters = row.eventFilters;
  const eventFilters = Array.isArray(filters) ? filters.map((x) => String(x)) : [];
  return {
    id,
    status: row.status != null ? String(row.status) : null,
    expirationTime: row.expirationTime != null ? String(row.expirationTime) : null,
    eventFilters,
    webhookAddress,
    transportType,
  };
}

/**
 * Lists webhook subscriptions visible to the JWT (for Workspace debug).
 * May omit some account-level rows depending on RingCentral API rules.
 */
export async function listRingCentralSubscriptionsForDebug(): Promise<RingCentralSubscriptionDebugRow[]> {
  const platform = await getRingCentralPlatform();
  const res = await platform.get("/restapi/v1.0/subscription");
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RingCentral list subscriptions failed (${res.status}): ${text.slice(0, 400)}`);
  }
  let body: { records?: unknown[] };
  try {
    body = JSON.parse(text) as { records?: unknown[] };
  } catch {
    throw new Error("RingCentral list subscriptions returned non-JSON.");
  }
  const out: RingCentralSubscriptionDebugRow[] = [];
  for (const rec of body.records ?? []) {
    const parsed = parseSubscriptionRecord(rec);
    if (parsed) out.push(parsed);
  }
  return out;
}
