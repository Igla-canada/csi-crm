import { endOfDay, parseISO, startOfDay } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";

import { getCurrentUser } from "@/lib/auth";
import { fetchClientsByIds, listPaymentEventsForExport } from "@/lib/crm";
import { signedPaymentAmountCents } from "@/lib/crm-types";
import { getUserCapabilities } from "@/lib/user-privileges";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  if (!caps.canViewReports) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromQ = req.nextUrl.searchParams.get("from")?.trim();
  const toQ = req.nextUrl.searchParams.get("to")?.trim();
  let range: { from: Date; to: Date } | undefined;
  if (fromQ && toQ) {
    const from = startOfDay(parseISO(fromQ));
    const to = endOfDay(parseISO(toQ));
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      range = { from, to };
    }
  }

  const rows = await listPaymentEventsForExport(range);
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const clientMap = await fetchClientsByIds(clientIds);

  const out = rows.map((r) => ({
    id: r.id,
    receivedAt: r.receivedAt.toISOString(),
    kind: r.kind,
    amountCents: r.amountCents,
    signedAmountCents: signedPaymentAmountCents(r.kind, r.amountCents),
    amountUsd: (r.amountCents / 100).toFixed(2),
    method: r.method,
    reference: r.reference ?? "",
    notes: (r.notes ?? "").replace(/\r?\n/g, " "),
    clientId: r.clientId,
    clientName: clientMap.get(r.clientId)?.displayName ?? "",
    appointmentId: r.appointmentId ?? "",
    linkedBookingTitle: r.linkedBooking?.title ?? "",
    linkedBookingStartAt: r.linkedBooking ? r.linkedBooking.startAt.toISOString() : "",
    callLogId: r.callLogId ?? "",
    recordedBy: r.recordedByName,
  }));

  const csv = Papa.unparse(out);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="crm-payments-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
