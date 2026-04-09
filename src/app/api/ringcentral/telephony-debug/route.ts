import { NextResponse } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import {
  getAppPublicUrl,
  getExtensionActiveCallsPollPlan,
  isExtensionActiveCallsPollEnabled,
  isRingCentralConfigured,
} from "@/lib/ringcentral/env";
import { listRingCentralExtensionsForDebug } from "@/lib/ringcentral/list-extensions-debug";
import { listTelephonyLiveSessionsDebug } from "@/lib/ringcentral/telephony-live-sessions";
import {
  listRingCentralSubscriptionsForDebug,
  type RingCentralSubscriptionDebugRow,
} from "@/lib/ringcentral/telephony-subscription";
import { getUserCapabilities } from "@/lib/user-privileges";

/** Free ngrok v3 hosts are `*.ngrok-free.app`. `*.ngrok-free` (no `.app`) is a common typo and breaks delivery. */
function looksLikeTruncatedNgrokFreeApp(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host.includes("ngrok")) return false;
    if (host.endsWith(".ngrok-free.app")) return false;
    return host.endsWith(".ngrok-free") || host === "ngrok-free";
  } catch {
    return false;
  }
}

/**
 * Admin-only: inspect TelephonyLiveSession rows and env hints when the live dock stays on “listening”.
 */
export async function GET() {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canConfigure) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const appUrl = getAppPublicUrl();
  const skipPoll = !isExtensionActiveCallsPollEnabled();
  const extensionPollPlan = getExtensionActiveCallsPollPlan();
  const webhookFullUrl = appUrl ? `${appUrl.replace(/\/$/, "")}/api/ringcentral/telephony-webhook` : null;
  const extIdEnvRaw =
    process.env.RINGCENTRAL_ACTIVE_CALLS_EXTENSION_IDS?.trim() ||
    process.env.RINGCENTRAL_ACTIVE_CALLS_EXTENSION_ID?.trim() ||
    null;

  let accountExtensions: Awaited<ReturnType<typeof listRingCentralExtensionsForDebug>> = [];
  let accountExtensionsError: string | null = null;
  try {
    accountExtensions = await listRingCentralExtensionsForDebug();
  } catch (e) {
    accountExtensionsError = e instanceof Error ? e.message : "Failed to list extensions.";
  }

  let subscriptions: RingCentralSubscriptionDebugRow[] = [];
  let subscriptionsError: string | null = null;
  try {
    subscriptions = await listRingCentralSubscriptionsForDebug();
  } catch (e) {
    subscriptionsError = e instanceof Error ? e.message : "Failed to list RingCentral subscriptions.";
  }

  const telephonySubs = subscriptions.filter(
    (s) =>
      s.eventFilters.some((f) => f.includes("telephony/sessions")) ||
      (s.webhookAddress ?? "").includes("telephony-webhook"),
  );
  const matchingDockSubs = webhookFullUrl
    ? telephonySubs.filter((s) => {
        try {
          const a = new URL(s.webhookAddress ?? "about:blank");
          const b = new URL(webhookFullUrl);
          return a.pathname === b.pathname && a.host === b.host;
        } catch {
          return (s.webhookAddress ?? "") === webhookFullUrl;
        }
      })
    : [];

  const hints: string[] = [
    "RingCentral sends webhooks to APP_URL (not to the browser address). Keep the ngrok agent running and tunneling to the same port as `next dev`.",
    "While on a live call, watch the `next dev` terminal for POST /api/ringcentral/telephony-webhook or [telephony-webhook] logs. No logs means RingCentral is not reaching your server (wrong subscription URL, expired subscription, or tunnel down).",
    "If payloadsSeen is always 0 in logs, paste the logged JSON snippet — the parser may need an update for your account’s payload shape.",
    "Console errors from vendor.js / tabs:outgoing / message channel closed are usually a browser extension, not this app.",
  ];

  if (appUrl && looksLikeTruncatedNgrokFreeApp(appUrl)) {
    hints.unshift(
      "APP_URL looks wrong: free ngrok URLs end with `.ngrok-free.app` (e.g. `https://YOUR_SUBDOMAIN.ngrok-free.app`). Fix `.env`, restart `next dev`, then register the telephony webhook again.",
    );
  }

  if (skipPoll && !subscriptionsError && subscriptions.length === 0) {
    hints.push(
      "Extension active-calls polling is OFF (default: webhook-only). Set `RINGCENTRAL_SKIP_EXTENSION_ACTIVE_CALLS=false` only if you need REST active-calls merged in. The dock needs the telephony webhook — register it below until `ringCentralSubscriptions` is non-empty.",
    );
  }

  if (appUrl && /ngrok-free\.app/i.test(appUrl)) {
    hints.push(
      "Ngrok free domains sometimes interfere with automated POSTs. If you never see webhook hits in the terminal, try a paid ngrok reserved domain, Cloudflare Tunnel, or deploy the app (e.g. Vercel) and set APP_URL to that HTTPS URL.",
    );
  }

  if (!subscriptionsError && telephonySubs.length === 0) {
    hints.push(
      "No RingCentral subscription mentions telephony sessions or this webhook path. In Workspace → RingCentral click “Register listen-only telephony webhook” (requires admin).",
    );
  } else if (!subscriptionsError && matchingDockSubs.length === 0 && telephonySubs.length > 0) {
    hints.push(
      `You have ${telephonySubs.length} telephony-related subscription(s), but none match the current webhook URL. Re-register the webhook after changing APP_URL or ngrok domain.`,
    );
  } else if (!subscriptionsError && matchingDockSubs.length > 0) {
    hints.push(
      `Found ${matchingDockSubs.length} subscription(s) matching this APP_URL webhook. If rowCount stays 0 during a call, check RingCentral developer portal → app permissions for telephony session notifications.`,
    );
  }

  if (extensionPollPlan.extensionIds.length > 0 && !accountExtensionsError) {
    if (accountExtensions.length === 0) {
      hints.push(
        "Extension id(s) are set in .env but no extensions were returned — check JWT permissions; remove the variables to use JWT default (~).",
      );
    } else {
      const unknown = extensionPollPlan.extensionIds.filter((id) => !accountExtensions.some((x) => x.id === id));
      if (unknown.length > 0) {
        hints.push(
          `These configured extension ids are not in accountExtensions[].id: ${unknown.join(", ")} — fix .env or remove them.`,
        );
      }
    }
  }

  try {
    const rows = await listTelephonyLiveSessionsDebug();
    return NextResponse.json({
      ok: true,
      configured: isRingCentralConfigured(),
      appUrl: appUrl ?? null,
      webhookExpectedAt: webhookFullUrl,
      skipExtensionActiveCallsPoll: skipPoll,
      extensionActiveCallsPollTarget: extensionPollPlan.describeTarget,
      extensionActiveCallsApiPaths: extensionPollPlan.paths,
      ringCentralActiveCallsExtensionIds: extensionPollPlan.extensionIds,
      ringCentralActiveCallsExtensionEnvRaw: extIdEnvRaw,
      accountExtensions,
      accountExtensionsError,
      rowCount: rows.length,
      rows,
      ringCentralSubscriptions: subscriptions,
      subscriptionsError,
      telephonyRelatedSubscriptions: telephonySubs,
      subscriptionsMatchingCurrentWebhookUrl: matchingDockSubs,
      hints,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to read TelephonyLiveSession.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
