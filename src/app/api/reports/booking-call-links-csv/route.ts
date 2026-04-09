import { endOfDay, parseISO, startOfDay } from "date-fns";
import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";

import { getCurrentUser } from "@/lib/auth";
import { listBookingCallLinkExportRows } from "@/lib/crm";
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

  const rows = await listBookingCallLinkExportRows(range);
  const out = rows.map((r) => ({
    appointmentId: r.appointmentId,
    clientId: r.clientId,
    clientName: r.clientDisplayName,
    title: r.title,
    startAt: r.startAtIso,
    callLogId: r.callLogId ?? "",
    callHappenedAt: r.callHappenedAtIso ?? "",
    callSummary: (r.callSummary ?? "").replace(/\r?\n/g, " "),
    booked: r.callLogId ? "yes" : "no",
  }));

  const csv = Papa.unparse(out);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="crm-booking-call-links-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
