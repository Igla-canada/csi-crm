import { endOfDay, formatISO, parseISO, startOfDay } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { fetchClientsByIds, listBookingCallLinkExportRows, listPaymentEventsForExport } from "@/lib/crm";
import { signedPaymentAmountCents } from "@/lib/crm-types";
import { getUserCapabilities } from "@/lib/user-privileges";

function parseRange(fromQ: string | null, toQ: string | null): { from: Date; to: Date } | undefined {
  if (!fromQ?.trim() || !toQ?.trim()) return undefined;
  const from = startOfDay(parseISO(fromQ.trim()));
  const to = endOfDay(parseISO(toQ.trim()));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return undefined;
  return { from, to };
}

function matchesTokens(haystack: string, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  const h = haystack.toLowerCase();
  return tokens.every((tok) => h.includes(tok));
}

type ExplorerPaymentRow = {
  id: string;
  clientId: string;
  clientName: string;
  receivedAt: string;
  kind: string;
  amountCents: number;
  signedAmountCents: number;
  method: string;
  reference: string | null;
  notes: string | null;
  appointmentId: string | null;
  callLogId: string | null;
  linkedBookingTitle: string | null;
  linkedBookingStartAt: string | null;
  recordedByName: string;
};

type ExplorerBookingRow = {
  appointmentId: string;
  clientId: string;
  clientName: string;
  title: string;
  startAtIso: string;
  callLogId: string | null;
  callHappenedAtIso: string | null;
  callSummary: string | null;
  linked: boolean;
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canViewReports) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const type = (req.nextUrl.searchParams.get("type") || "payments").trim();
  const range = parseRange(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"));
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (type === "bookings") {
    const rows = await listBookingCallLinkExportRows(range);
    const mapped: ExplorerBookingRow[] = rows.map((r) => ({
      appointmentId: r.appointmentId,
      clientId: r.clientId,
      clientName: r.clientDisplayName,
      title: r.title,
      startAtIso: r.startAtIso,
      callLogId: r.callLogId,
      callHappenedAtIso: r.callHappenedAtIso,
      callSummary: r.callSummary,
      linked: Boolean(r.callLogId),
    }));
    const filtered = q
      ? mapped.filter((r) =>
          matchesTokens(
            [
              r.appointmentId,
              r.clientId,
              r.clientName,
              r.title,
              r.callSummary ?? "",
              r.callLogId ?? "",
              r.startAtIso,
              r.callHappenedAtIso ?? "",
              r.linked ? "booked yes" : "no",
            ].join(" "),
            q,
          ),
        )
      : mapped;
    return NextResponse.json({
      type: "bookings" as const,
      rows: filtered,
      rangeBoundaries: range
        ? { from: formatISO(range.from, { representation: "date" }), to: formatISO(range.to, { representation: "date" }) }
        : null,
    });
  }

  if (type !== "payments") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const events = await listPaymentEventsForExport(range);
  const clientIds = [...new Set(events.map((e) => e.clientId))];
  const clientMap = await fetchClientsByIds(clientIds);

  const mapped: ExplorerPaymentRow[] = events.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: clientMap.get(r.clientId)?.displayName ?? "",
    receivedAt: r.receivedAt.toISOString(),
    kind: r.kind,
    amountCents: r.amountCents,
    signedAmountCents: signedPaymentAmountCents(r.kind, r.amountCents),
    method: r.method,
    reference: r.reference,
    notes: r.notes,
    appointmentId: r.appointmentId,
    callLogId: r.callLogId,
    linkedBookingTitle: r.linkedBooking?.title ?? null,
    linkedBookingStartAt: r.linkedBooking ? r.linkedBooking.startAt.toISOString() : null,
    recordedByName: r.recordedByName,
  }));

  const filtered = q
    ? mapped.filter((r) =>
        matchesTokens(
          [
            r.id,
            r.clientId,
            r.clientName,
            r.kind,
            r.method,
            r.reference ?? "",
            r.notes ?? "",
            r.appointmentId ?? "",
            r.callLogId ?? "",
            r.linkedBookingTitle ?? "",
            r.linkedBookingStartAt ?? "",
            r.recordedByName,
            r.receivedAt,
            String(r.amountCents),
            String(r.signedAmountCents),
          ].join(" "),
          q,
        ),
      )
    : mapped;

  return NextResponse.json({
    type: "payments" as const,
    rows: filtered,
    rangeBoundaries: range
      ? { from: formatISO(range.from, { representation: "date" }), to: formatISO(range.to, { representation: "date" }) }
      : null,
  });
}
