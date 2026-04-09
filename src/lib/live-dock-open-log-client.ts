"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import {
  lookupClientsByPhoneAction,
  markInboundStubOpenedFromLiveDockAction,
} from "@/app/actions";
import { CallDirection } from "@/lib/db";
import { INBOUND_CALL_HISTORY_REFRESH_EVENT } from "@/lib/call-history-refresh-event";
import type { ActiveDockCallSnapshot } from "@/lib/live-dock-call-types";

const SESSION_PREFIX = "csicrm:DockOpenedLogPhone:";
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

function normalizeDigits(raw: string): string {
  let x = raw.replace(/\D/g, "");
  if (x.length === 11 && x.startsWith("1")) x = x.slice(1);
  return x;
}

/** When no DB stub existed yet, suppress table “Open log” for placeholder stubs on this line until TTL. */
export function rememberDockOpenedStubPendingForPhoneDigits(phoneDigits: string): void {
  const key = normalizeDigits(phoneDigits);
  if (key.length < 3) return;
  try {
    sessionStorage.setItem(SESSION_PREFIX + key, String(Date.now()));
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("csicrm:dock-open-log-suppress"));
  }
}

function sessionSuppressActive(phoneDigits: string): boolean {
  const key = normalizeDigits(phoneDigits);
  if (key.length < 3) return false;
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return false;
    const t = Number(raw);
    if (!Number.isFinite(t) || Date.now() - t > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_PREFIX + key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** True when this history row is a RingCentral placeholder stub and the user already used the dock for this number. */
export function isInboundHistoryOpenLogSuppressedByLiveDock(
  contactPhone: string | null,
  telephonyDraft: boolean,
  summaryTrimmed: string,
  placeholderSummary: string,
): boolean {
  if (!telephonyDraft || summaryTrimmed !== placeholderSummary) return false;
  if (!contactPhone?.trim()) return false;
  return sessionSuppressActive(contactPhone);
}

export async function navigateOpenLiveCallLogFromDock(
  c: ActiveDockCallSnapshot,
  router: AppRouterInstance,
  canLogCalls: boolean,
): Promise<void> {
  if (!canLogCalls) return;
  const digits = c.phoneDigits.trim();
  if (digits) {
    const r = await markInboundStubOpenedFromLiveDockAction(digits);
    if (r.ok && !r.marked) {
      rememberDockOpenedStubPendingForPhoneDigits(digits);
    }
  }

  const matches = digits ? await lookupClientsByPhoneAction(digits) : [];
  const q = new URLSearchParams();
  q.set("liveLog", "1");
  q.set("phone", c.phoneDisplay);
  if (digits) q.set("phoneDigits", digits);
  if (c.callerName?.trim()) q.set("contactName", c.callerName.trim());
  q.set("direction", c.direction === "OUTBOUND" ? CallDirection.OUTBOUND : CallDirection.INBOUND);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INBOUND_CALL_HISTORY_REFRESH_EVENT));
  }

  if (matches.length === 1) {
    router.push(`/clients/${matches[0]!.id}?${q.toString()}`);
  } else {
    router.push(`/calls?${q.toString()}`);
  }
}
