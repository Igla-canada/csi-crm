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
  const address = `${base.replace(/\/$/, "")}/api/ringcentral/telephony-webhook`;
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

/** Renew account telephony webhooks this many milliseconds before expiry (RingCentral subscriptions are short-lived). */
const TELEPHONY_WEBHOOK_RENEW_WITHIN_MS = 14 * 24 * 60 * 60 * 1000;

function buildTelephonyWebhookAddress(): string {
  const raw = getAppPublicUrl();
  if (!raw) {
    throw new Error("APP_URL is not set. RingCentral must reach your server over HTTPS.");
  }
  const base = raw.replace(/\/$/, "");
  return `${base}/api/ringcentral/telephony-webhook`;
}

function webhookDeliveryUrlsMatch(webhookAddress: string | null, expectedFullUrl: string): boolean {
  const a = (webhookAddress ?? "").trim();
  if (!a) return false;
  try {
    const ua = new URL(a);
    const ub = new URL(expectedFullUrl);
    const pa = ua.pathname.replace(/\/$/, "") || "/";
    const pb = ub.pathname.replace(/\/$/, "") || "/";
    return ua.host === ub.host && pa === pb;
  } catch {
    return a === expectedFullUrl;
  }
}

export type RenewOrEnsureTelephonyWebhookResult = {
  action: "renewed" | "created" | "noop";
  subscriptionId: string | null;
  expirationTime: string | null;
  message: string;
};

/**
 * For scheduled jobs: renew the existing account telephony session subscription before it expires, or create one if
 * none matches `APP_URL`. Idempotent when the subscription is still healthy.
 */
export async function renewOrEnsureAccountTelephonyWebhook(): Promise<RenewOrEnsureTelephonyWebhookResult> {
  const expectedAddress = buildTelephonyWebhookAddress();
  const subs = await listRingCentralSubscriptionsForDebug();
  const candidates = subs.filter(
    (s) =>
      s.eventFilters.some((f) => f.includes("telephony/sessions")) &&
      webhookDeliveryUrlsMatch(s.webhookAddress, expectedAddress),
  );
  candidates.sort((a, b) => {
    const ta = a.expirationTime ? new Date(a.expirationTime).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.expirationTime ? new Date(b.expirationTime).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  const pick = candidates[0];
  const now = Date.now();
  const platform = await getRingCentralPlatform();

  if (!pick) {
    const created = await subscribeAccountTelephonyWebhooks();
    return {
      action: "created",
      subscriptionId: created.id != null ? String(created.id) : null,
      expirationTime: created.expirationTime != null ? String(created.expirationTime) : null,
      message: "No matching telephony webhook subscription — created a new one.",
    };
  }

  const expMs = pick.expirationTime ? new Date(pick.expirationTime).getTime() : NaN;
  const status = (pick.status ?? "").toLowerCase();
  const needsRenew =
    status === "blacklisted" ||
    status === "suspended" ||
    !Number.isFinite(expMs) ||
    expMs <= now + TELEPHONY_WEBHOOK_RENEW_WITHIN_MS;

  if (!needsRenew) {
    return {
      action: "noop",
      subscriptionId: pick.id,
      expirationTime: pick.expirationTime,
      message: `Telephony webhook subscription ok until ${pick.expirationTime ?? "unknown"}.`,
    };
  }

  const res = await platform.post(`/restapi/v1.0/subscription/${encodeURIComponent(pick.id)}/renew`, {});
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404) {
      const created = await subscribeAccountTelephonyWebhooks();
      return {
        action: "created",
        subscriptionId: created.id != null ? String(created.id) : null,
        expirationTime: created.expirationTime != null ? String(created.expirationTime) : null,
        message: "Renew returned 404 — created a new telephony webhook subscription.",
      };
    }
    throw new Error(`RingCentral subscription renew failed (${res.status}): ${text.slice(0, 500)}`);
  }

  let renewed: Record<string, unknown>;
  try {
    renewed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      action: "renewed",
      subscriptionId: pick.id,
      expirationTime: pick.expirationTime,
      message: "Subscription renew succeeded (response was not JSON).",
    };
  }

  const newId = renewed.id != null ? String(renewed.id) : pick.id;
  const newExp =
    renewed.expirationTime != null ? String(renewed.expirationTime) : (pick.expirationTime ?? null);
  return {
    action: "renewed",
    subscriptionId: newId,
    expirationTime: newExp,
    message: `Renewed telephony webhook subscription${newExp ? `; expires ${newExp}` : ""}.`,
  };
}
