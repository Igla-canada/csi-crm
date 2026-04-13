import "server-only";

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v === "" ? undefined : v;
}

export type RingCentralEnv = {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  jwt: string;
  /** CRM `User.id` used as `CallLog.userId` for telephony-created logs. */
  integrationUserId: string;
};

/** Default RingCentral API host (override with RINGCENTRAL_SERVER_URL for sandbox). */
export const RINGCENTRAL_DEFAULT_SERVER = "https://platform.ringcentral.com";

export function getRingCentralEnv(): RingCentralEnv | null {
  const clientId = trimEnv("RINGCENTRAL_CLIENT_ID");
  const clientSecret = trimEnv("RINGCENTRAL_CLIENT_SECRET");
  const jwt = trimEnv("RINGCENTRAL_JWT");
  const integrationUserId = trimEnv("RINGCENTRAL_INTEGRATION_USER_ID");
  const serverUrl = trimEnv("RINGCENTRAL_SERVER_URL") ?? RINGCENTRAL_DEFAULT_SERVER;
  if (!clientId || !clientSecret || !jwt || !integrationUserId) return null;
  return { serverUrl, clientId, clientSecret, jwt, integrationUserId };
}

export function isRingCentralConfigured(): boolean {
  return getRingCentralEnv() !== null;
}

/** Optional shared secret checked on AI webhook requests (`x-ringcentral-webhook-secret`). */
export function getRingCentralWebhookSecret(): string | null {
  return trimEnv("RINGCENTRAL_WEBHOOK_SECRET") ?? null;
}

export function getRingCentralAutoTranscribe(): boolean {
  return trimEnv("RINGCENTRAL_AUTO_TRANSCRIBE") === "true";
}

/** Public base URL for webhooks (AI callback) and links. No trailing slash. */
export function getAppPublicUrl(): string | null {
  const explicit = trimEnv("APP_URL") ?? trimEnv("NEXT_PUBLIC_APP_URL");
  if (explicit) {
    let base = explicit.replace(/\/$/, "");
    // Avoid double path if someone pastes the full webhook URL as APP_URL.
    const telephonySuffix = "/api/ringcentral/telephony-webhook";
    if (base.endsWith(telephonySuffix)) {
      base = base.slice(0, -telephonySuffix.length).replace(/\/$/, "");
    }
    return base;
  }
  const vercel = trimEnv("VERCEL_URL");
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return null;
}

function parseExtensionIdsFromEnv(): string[] {
  const multi = trimEnv("RINGCENTRAL_ACTIVE_CALLS_EXTENSION_IDS");
  const single = trimEnv("RINGCENTRAL_ACTIVE_CALLS_EXTENSION_ID");
  const raw = multi ?? single;
  if (!raw) return [];
  const parts = raw.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  return [...new Set(parts.filter((p) => /^\d+$/.test(p)))];
}

/**
 * One or more `GET …/extension/{id}/active-calls` plus optional JWT default.
 * - No env: only `…/extension/~/active-calls` (JWT’s extension).
 * - `RINGCENTRAL_ACTIVE_CALLS_EXTENSION_ID` or `RINGCENTRAL_ACTIVE_CALLS_EXTENSION_IDS`: comma/space/semicolon-separated **numeric ids** from GET /account/~/extension. Each id is polled and results are merged for the live dock.
 */
const JWT_ACTIVE_CALLS_PATH = "/restapi/v1.0/account/~/extension/~/active-calls";

export function getExtensionActiveCallsPollPlan(): {
  paths: string[];
  describeTarget: string;
  extensionIds: string[];
} {
  const ids = parseExtensionIdsFromEnv();
  const alsoJwt = trimEnv("RINGCENTRAL_ACTIVE_CALLS_ALSO_POLL_JWT_DEFAULT") === "true";

  if (ids.length === 0) {
    return {
      paths: [JWT_ACTIVE_CALLS_PATH],
      describeTarget: "JWT default extension (~)",
      extensionIds: [],
    };
  }

  const idPaths = ids.map((id) => `/restapi/v1.0/account/~/extension/${id}/active-calls`);
  const paths = alsoJwt ? [JWT_ACTIVE_CALLS_PATH, ...idPaths] : idPaths;
  const describeTarget = alsoJwt
    ? `JWT (~) + ${ids.length} id(s): ${ids.join(", ")}`
    : ids.length === 1
      ? `extension id ${ids[0]}`
      : `${ids.length} extensions: ${ids.join(", ")}`;
  return { paths, describeTarget, extensionIds: ids };
}

/** First path only — prefer `getExtensionActiveCallsPollPlan` for multi-id. */
export function getExtensionActiveCallsApiPath(): { path: string; describeTarget: string } {
  const plan = getExtensionActiveCallsPollPlan();
  return { path: plan.paths[0]!, describeTarget: plan.describeTarget };
}

/**
 * When true, each `GET /api/ringcentral/active-calls` also calls RingCentral
 * `GET …/extension/{id}/active-calls` (see {@link getExtensionActiveCallsPollPlan}).
 *
 * **Default off** (webhook-only dock): unset, empty, or `RINGCENTRAL_SKIP_EXTENSION_ACTIVE_CALLS=true` all skip REST polling.
 * Set **`RINGCENTRAL_SKIP_EXTENSION_ACTIVE_CALLS=false`** to opt in and merge extension active-calls (uses RC API quota).
 */
export function isExtensionActiveCallsPollEnabled(): boolean {
  return trimEnv("RINGCENTRAL_SKIP_EXTENSION_ACTIVE_CALLS") === "false";
}

/**
 * Extension **numbers** (e.g. 101,103) that only ring briefly before unconditional forward to another ext
 * (e.g. 202). Carrier call logs often show "Missed" on these legs even when the call was answered on the target.
 * We ignore those missed legs when picking the CRM result from a Detailed call-log tree (see call-result.ts).
 * Comma / space / semicolon separated.
 */
export function getRingCentralCallLogStagingExtensionNumbers(): ReadonlySet<string> {
  const raw = trimEnv("RINGCENTRAL_CALL_LOG_STAGING_EXTENSION_NUMBERS");
  if (!raw) return new Set();
  const out = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const d = part.trim().replace(/\D/g, "");
    if (d.length >= 2 && d.length <= 8) out.add(d);
  }
  return out;
}

/**
 * After RingCentral reports all parties ended, wait this long before writing the CRM call log so parallel
 * hunt/forward legs can finish. Set to 0 to disable (immediate import, previous behavior).
 * Default 12000 ms.
 */
export function getTelephonySessionEndGraceMs(): number {
  const raw = trimEnv("RINGCENTRAL_TELEPHONY_SESSION_END_GRACE_MS");
  if (raw == null || raw === "") return 12_000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 12_000;
  return Math.min(Math.max(Math.floor(n), 0), 60_000);
}
