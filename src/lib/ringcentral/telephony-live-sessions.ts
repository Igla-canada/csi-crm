import "server-only";

import { getSupabaseAdmin, tables } from "@/lib/db";

export type TelephonyLiveSessionRow = {
  telephonySessionId: string;
  direction: string;
  statusCode: string;
  phoneDigits: string;
  phoneDisplay: string;
  callerName: string | null;
  updatedAt: string;
  /** When set, session is in post-call grace before CRM import (see telephony-session-notify). */
  endingGraceUntil?: string | null;
  endingStubJson?: string | null;
  endingToken?: string | null;
};

/** Active rows should refresh often from webhook/poll; stale rows should disappear quickly from dock UI. */
const ACTIVE_ROW_TTL_MS = 12 * 60 * 1000;
/** If deferred finalize fails, never keep a "Finishing call" row around for long. */
const FINISHING_ROW_EXPIRED_GRACE_MS = 2 * 60 * 1000;

function sb() {
  return getSupabaseAdmin();
}

export async function purgeStaleTelephonyLiveSessions(): Promise<void> {
  const staleCutoff = new Date(Date.now() - ACTIVE_ROW_TTL_MS).toISOString();
  const finishingCutoff = new Date(Date.now() - FINISHING_ROW_EXPIRED_GRACE_MS).toISOString();
  const [stale, finishing] = await Promise.all([
    sb().from(tables.TelephonyLiveSession).delete().lt("updatedAt", staleCutoff),
    sb()
      .from(tables.TelephonyLiveSession)
      .delete()
      .not("endingGraceUntil", "is", null)
      .lt("endingGraceUntil", finishingCutoff),
  ]);
  if (stale.error) throw stale.error;
  if (finishing.error) throw finishing.error;
}

export async function upsertTelephonyLiveSession(
  row: Omit<TelephonyLiveSessionRow, "updatedAt">,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const { error } = await sb()
    .from(tables.TelephonyLiveSession)
    .upsert(
      {
        telephonySessionId: row.telephonySessionId,
        direction: row.direction,
        statusCode: row.statusCode,
        phoneDigits: row.phoneDigits,
        phoneDisplay: row.phoneDisplay,
        callerName: row.callerName,
        endingGraceUntil: row.endingGraceUntil ?? null,
        endingStubJson: row.endingStubJson ?? null,
        endingToken: row.endingToken ?? null,
        updatedAt,
      },
      { onConflict: "telephonySessionId" },
    );
  if (error) throw error;
}

export async function deleteTelephonyLiveSession(telephonySessionId: string): Promise<void> {
  const { error } = await sb().from(tables.TelephonyLiveSession).delete().eq("telephonySessionId", telephonySessionId);
  if (error) throw error;
}

export async function listTelephonyLiveSessionsForDock(): Promise<TelephonyLiveSessionRow[]> {
  await purgeStaleTelephonyLiveSessions();
  const { data, error } = await sb()
    .from(tables.TelephonyLiveSession)
    .select(
      "telephonySessionId,direction,statusCode,phoneDigits,phoneDisplay,callerName,updatedAt,endingGraceUntil,endingStubJson,endingToken",
    )
    .order("updatedAt", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as TelephonyLiveSessionRow[];
}

/** Admin debug: current rows without TTL purge so you can see what webhooks last wrote. */
export async function listTelephonyLiveSessionsDebug(): Promise<TelephonyLiveSessionRow[]> {
  const { data, error } = await sb()
    .from(tables.TelephonyLiveSession)
    .select(
      "telephonySessionId,direction,statusCode,phoneDigits,phoneDisplay,callerName,updatedAt,endingGraceUntil,endingStubJson,endingToken",
    )
    .order("updatedAt", { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as TelephonyLiveSessionRow[];
}

export async function getTelephonyLiveSessionRow(
  telephonySessionId: string,
): Promise<TelephonyLiveSessionRow | null> {
  const id = telephonySessionId.trim();
  if (!id) return null;
  const { data, error } = await sb()
    .from(tables.TelephonyLiveSession)
    .select(
      "telephonySessionId,direction,statusCode,phoneDigits,phoneDisplay,callerName,updatedAt,endingGraceUntil,endingStubJson,endingToken",
    )
    .eq("telephonySessionId", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TelephonyLiveSessionRow | null;
}
