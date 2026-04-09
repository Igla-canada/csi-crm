import { format } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, SectionHeading } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { filterClientsBySearchQuery } from "@/lib/client-search";
import { getClientsOverview, type ClientListRow } from "@/lib/crm";
import { getUserCapabilities } from "@/lib/user-privileges";

const SORT_KEYS = ["name", "phone", "vehicle", "note", "callStatus", "recording", "activity", "status"] as const;
type SortKey = (typeof SORT_KEYS)[number];

function parseSortParams(
  sort: string | undefined,
  dir: string | undefined,
): { key: SortKey; dir: "asc" | "desc" } {
  const normalized = sort === "updated" ? "activity" : sort;
  const key = SORT_KEYS.includes(normalized as SortKey) ? (normalized as SortKey) : "activity";
  const d = dir === "asc" ? "asc" : "desc";
  return { key, dir: d };
}

function nextSortClick(currentKey: SortKey, currentDir: "asc" | "desc", clicked: SortKey): { sort: SortKey; dir: "asc" | "desc" } {
  if (clicked === currentKey) {
    return { sort: clicked, dir: currentDir === "asc" ? "desc" : "asc" };
  }
  const defaultDir: "asc" | "desc" =
    clicked === "activity" || clicked === "recording" ? "desc" : "asc";
  return { sort: clicked, dir: defaultDir };
}

function sortClientsList(rows: ClientListRow[], key: SortKey, dir: "asc" | "desc"): ClientListRow[] {
  const mult = dir === "asc" ? 1 : -1;
  const cmpStr = (a: string, b: string) => mult * a.localeCompare(b, undefined, { sensitivity: "base" });
  const cmpNum = (a: number, b: number) => mult * (a - b);

  return [...rows].sort((x, y) => {
    switch (key) {
      case "name": {
        const c = cmpStr(x.displayName ?? "", y.displayName ?? "");
        return c !== 0 ? c : cmpStr(x.id, y.id);
      }
      case "phone":
        return cmpStr(x.contactPoints[0]?.value ?? "", y.contactPoints[0]?.value ?? "");
      case "vehicle": {
        const vx = `${x.vehicles[0]?.label ?? ""} ${x.opportunities[0]?.productDisplay ?? x.opportunities[0]?.product ?? ""}`.trim();
        const vy = `${y.vehicles[0]?.label ?? ""} ${y.opportunities[0]?.productDisplay ?? y.opportunities[0]?.product ?? ""}`.trim();
        return cmpStr(vx, vy);
      }
      case "note":
        return cmpStr(x.callLogs[0]?.summary ?? "", y.callLogs[0]?.summary ?? "");
      case "callStatus":
        return cmpStr(x.latestTelephonyResult ?? "", y.latestTelephonyResult ?? "");
      case "recording":
        return cmpNum(x.latestCallHasRecording ? 1 : 0, y.latestCallHasRecording ? 1 : 0);
      case "status":
        return cmpStr(x.openStatusLabel ?? "", y.openStatusLabel ?? "");
      case "activity":
        return cmpNum(x.lastActivityAt.getTime(), y.lastActivityAt.getTime());
      default:
        return 0;
    }
  });
}

function sortHref(q: string, sort: SortKey, dir: "asc" | "desc"): string {
  const p = new URLSearchParams();
  const qt = q.trim();
  if (qt) p.set("q", qt);
  p.set("sort", sort);
  p.set("dir", dir);
  return `/clients?${p.toString()}`;
}

function SortTh({
  label,
  sortKey,
  activeKey,
  activeDir,
  q,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  activeDir: "asc" | "desc";
  q: string;
}) {
  const next = nextSortClick(activeKey, activeDir, sortKey);
  const href = sortHref(q, next.sort, next.dir);
  const isActive = activeKey === sortKey;
  return (
    <th
      className="px-4 py-4 font-medium"
      scope="col"
      aria-sort={isActive ? (activeDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded-md text-inherit outline-offset-2 hover:text-[#1e5ea8] focus-visible:ring-2 focus-visible:ring-[#1e5ea8]/40"
      >
        <span className="border-b border-dotted border-current/40 hover:border-solid">{label}</span>
        {isActive ? (
          <span className="tabular-nums text-[#1e5ea8]" aria-hidden>
            {activeDir === "asc" ? "↑" : "↓"}
          </span>
        ) : null}
      </Link>
    </th>
  );
}

type SearchProps = {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    dir?: string;
  }>;
};

export default async function ClientsPage({ searchParams }: SearchProps) {
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  if (!caps.canViewClients) {
    redirect("/");
  }
  const { q = "", sort: sortRaw, dir: dirRaw } = await searchParams;
  const clients = await getClientsOverview();
  const queryTrimmed = q.trim();
  const { key: sortKey, dir: sortDir } = parseSortParams(sortRaw, dirRaw);

  const filtered = filterClientsBySearchQuery(clients, queryTrimmed);
  const rows = sortClientsList(filtered, sortKey, sortDir);

  return (
    <div className="crm-grid">
      <SectionHeading
        eyebrow="Clients"
        title="Search by caller, vehicle, or service interest."
        text="Use the header search or the list below. Matches name, company, phone (any format), email on file, vehicles, and products. Open a row to see the full client card, call history, and bookings."
      />

      {queryTrimmed ? (
        <p className="text-sm text-slate-600">
          {rows.length === 0 ? (
            <>
              No clients match <span className="font-medium text-slate-800">&quot;{queryTrimmed}&quot;</span>. Try a
              different spelling, phone digits only, or{" "}
              <Link href="/clients" className="font-semibold text-[#1e5ea8] hover:text-[#17497f]">
                clear search
              </Link>
              .
            </>
          ) : (
            <>
              {rows.length} client{rows.length === 1 ? "" : "s"} matching{" "}
              <span className="font-medium text-slate-800">&quot;{queryTrimmed}&quot;</span>
              .{" "}
              <Link href="/clients" className="font-semibold text-[#1e5ea8] hover:text-[#17497f]">
                Show all
              </Link>
            </>
          )}
        </p>
      ) : null}

      <Card>
        <div className="crm-table-shell">
          <table className="min-w-full text-left text-sm">
            <thead className="crm-table-head">
              <tr>
                <SortTh label="Client" sortKey="name" activeKey={sortKey} activeDir={sortDir} q={q} />
                <SortTh label="Primary contact" sortKey="phone" activeKey={sortKey} activeDir={sortDir} q={q} />
                <SortTh label="Vehicle / interest" sortKey="vehicle" activeKey={sortKey} activeDir={sortDir} q={q} />
                <SortTh label="Latest note" sortKey="note" activeKey={sortKey} activeDir={sortDir} q={q} />
                <SortTh label="Call status" sortKey="callStatus" activeKey={sortKey} activeDir={sortDir} q={q} />
                <SortTh label="Recording" sortKey="recording" activeKey={sortKey} activeDir={sortDir} q={q} />
                <SortTh
                  label="Last activity"
                  sortKey="activity"
                  activeKey={sortKey}
                  activeDir={sortDir}
                  q={q}
                />
                <SortTh label="Open status" sortKey="status" activeKey={sortKey} activeDir={sortDir} q={q} />
                <th className="px-4 py-4 font-medium" scope="col">
                  Client card
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                    {queryTrimmed
                      ? "No matches. Adjust your search or clear it to see every client."
                      : "No clients yet. Add one from Log a Call or Import."}
                  </td>
                </tr>
              ) : null}
              {rows.map((client) => (
                <tr key={client.id} className="crm-table-row">
                  <td className="px-4 py-4 align-top">
                    <Link href={`/clients/${client.id}`} className="font-semibold text-slate-900 transition hover:text-blue-700">
                      {client.displayName}
                    </Link>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                      {client.source || "Unknown source"}
                    </p>
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">
                    {client.contactPoints[0]?.value || "No primary number"}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <p className="text-slate-700">{client.vehicles[0]?.label || "Vehicle pending"}</p>
                    <p className="crm-blue-accent mt-1 text-xs">
                      {(client.opportunities[0]?.productDisplay ??
                        client.opportunities[0]?.product) ||
                        "General inquiry"}
                    </p>
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">
                    {client.callLogs[0]?.summary || "No notes yet"}
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">
                    {client.latestTelephonyResult?.trim() ? (
                      <span
                        className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200/90"
                        title="From RingCentral on the latest call"
                      >
                        {client.latestTelephonyResult.trim()}
                      </span>
                    ) : client.callLogs[0] ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top">
                    {client.callLogs[0] ? (
                      <span
                        className={
                          client.latestCallHasRecording
                            ? "inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-950 ring-1 ring-emerald-200/90"
                            : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/90"
                        }
                        title={
                          client.latestCallHasRecording
                            ? "Latest call has a linked recording"
                            : "No recording stored on the latest call"
                        }
                      >
                        {client.latestCallHasRecording ? "Yes" : "No"}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">
                    <time dateTime={client.lastActivityAt.toISOString()} className="block text-slate-800">
                      {format(client.lastActivityAt, "MMM d, yyyy")}
                    </time>
                    <span className="mt-0.5 block text-xs text-slate-500">{format(client.lastActivityAt, "h:mm a")}</span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className="crm-badge" title="From the most recent call on the client card">
                      {client.openStatusLabel}
                    </span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <Link
                      href={`/clients/${client.id}`}
                      className="inline-flex text-sm font-semibold text-[#1e5ea8] hover:text-[#17497f]"
                    >
                      Open card
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
