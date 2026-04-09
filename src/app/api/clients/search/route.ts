import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUserForApi } from "@/lib/auth";
import { filterClientsBySearchQuery } from "@/lib/client-search";
import { getClientsOverview } from "@/lib/crm";
import { getUserCapabilities } from "@/lib/user-privileges";

const MAX = 12;

export type ClientSearchHit = {
  id: string;
  name: string;
  phone: string;
  vehicle: string;
};

/**
 * JSON suggestions for header client search (debounced on the client).
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (raw.length < 2) {
    return NextResponse.json({ clients: [] satisfies ClientSearchHit[] });
  }

  const user = await getCurrentUserForApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caps = getUserCapabilities(user);
  if (!caps.canViewClients) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const all = await getClientsOverview();
  const filtered = filterClientsBySearchQuery(all, raw);
  const clients: ClientSearchHit[] = filtered.slice(0, MAX).map((c) => ({
    id: c.id,
    name: c.displayName,
    phone: c.contactPoints[0]?.value?.trim() || "—",
    vehicle: c.vehicles[0]?.label?.trim() || "—",
  }));

  return NextResponse.json({ clients });
}
