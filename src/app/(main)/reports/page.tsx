import { endOfMonth, formatISO, startOfMonth } from "date-fns";

import { Card, SectionHeading } from "@/components/app-shell";
import { ReportsExportsExplorer } from "@/components/reports-exports-explorer";
import { ReportsTabNav, type ReportsTab } from "@/components/reports-tab-nav";
import { getCurrentUser } from "@/lib/auth";
import { resolveCallResultDisplayHex } from "@/lib/call-result-accents";
import { getCallResultOptions, getReportsOverview } from "@/lib/crm";
import { chartColors } from "@/lib/crm-shared";
import { getUserCapabilities } from "@/lib/user-privileges";
import { redirect } from "next/navigation";

type ReportsPageProps = {
  searchParams: Promise<{ tab?: string }>;
};

function resolveReportsTab(raw: string | undefined): ReportsTab {
  if (raw === "deposits") return "deposits";
  if (raw === "bookings") return "bookings";
  return "overview";
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const { tab: tabRaw } = await searchParams;
  const tab = resolveReportsTab(tabRaw);

  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  if (!caps.canViewReports) {
    redirect("/");
  }

  const [reports, outcomeOptions] = await Promise.all([getReportsOverview(), getCallResultOptions(false)]);
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const monthFrom = formatISO(monthStart, { representation: "date" });
  const monthTo = formatISO(monthEnd, { representation: "date" });
  const labelByCode = new Map(outcomeOptions.map((o) => [o.code, o.label]));
  const maxSourceCount = Math.max(1, ...reports.bySource.map((e) => e._count));
  const stripeHexByCode = new Map(
    outcomeOptions.map((o) => {
      const code = String(o.code);
      return [
        code,
        resolveCallResultDisplayHex(
          (o as { accentHex?: string | null }).accentHex,
          o.accentKey as string | null | undefined,
          code,
        ),
      ] as const;
    }),
  );

  const heading =
    tab === "overview"
      ? {
          title: "Track lead sources, team activity, and demand trends.",
          text: "Where leads came from, what services show up on calls, call outcomes, and how active each staff member is logging calls.",
        }
      : tab === "deposits"
        ? {
            title: "Deposits, payments, and refunds.",
            text: "Filter by time range and search across notes, clients, and linked bookings. CSV download uses the same dates (not the search). Edit or remove rows when something was logged wrong.",
          }
        : {
            title: "Bookings and call links.",
            text: "Every booking with optional trace back to the call log. Filter by booking start date and search call summaries or titles.",
          };

  return (
    <div className="crm-grid">
      <SectionHeading eyebrow="Reporting" title={heading.title} text={heading.text} />

      <ReportsTabNav active={tab} />

      {tab === "overview" ? (
        <>
          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <h3 className="text-xl font-semibold text-slate-900">Lead sources</h3>
              <div className="mt-6 space-y-4 overflow-hidden">
                {reports.bySource.map((entry, index) => {
                  const pct = Math.min(100, Math.max(6, (entry._count / maxSourceCount) * 100));
                  return (
                    <div key={entry.source ?? `unknown-${index}`}>
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-slate-600" title={entry.source || "Unknown source"}>
                          {entry.source || "Unknown source"}
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-900">{entry._count}</span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-[#e7f0fa]">
                        <div
                          className="h-3 max-w-full rounded-full transition-[width]"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: chartColors[index % chartColors.length],
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <h3 className="text-xl font-semibold text-slate-900">Call results</h3>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {reports.byOutcome.map((entry) => {
                  const hex = stripeHexByCode.get(entry.outcomeCode) ?? "#64748b";
                  return (
                    <div
                      key={entry.outcomeCode}
                      className="crm-soft-row rounded-[22px] border-l-4 p-4"
                      style={{ borderLeftColor: hex }}
                    >
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                        {labelByCode.get(entry.outcomeCode) ?? entry.outcomeCode}
                      </p>
                      <p className="mt-3 text-3xl font-bold text-slate-900">{entry._count}</p>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <Card>
              <h3 className="text-xl font-semibold text-slate-900">Staff activity</h3>
              <div className="mt-6 space-y-3">
                {reports.staffActivity.map((entry) => (
                  <div key={entry.userId} className="crm-soft-row rounded-[22px] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{entry.user?.name || "Unknown user"}</p>
                        <p className="mt-1 text-sm text-slate-500">{entry.user?.role || "No role"}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-slate-900">{entry._count}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">logged calls</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h3 className="text-xl font-semibold text-slate-900">Service demand mix</h3>
              <p className="mt-2 text-sm text-slate-500">
                Counts from call logs (product / service), grouped with call result. Configure labels in Workspace → Products
                / services.
              </p>
              <div className="mt-6 space-y-3">
                {reports.productInterest.map((entry) => (
                  <div
                    key={`${entry.productCode}-${entry.outcomeCode}`}
                    className="crm-soft-row rounded-[22px] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p
                          className="break-words font-semibold text-slate-900 line-clamp-3"
                          title={entry.productLabel}
                        >
                          {entry.productLabel}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {labelByCode.get(entry.outcomeCode) ?? entry.outcomeCode}
                        </p>
                      </div>
                      <span className="shrink-0 crm-badge">{entry._count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        </>
      ) : tab === "deposits" ? (
        <Card>
          <h3 className="text-xl font-semibold text-slate-900">Payment log</h3>
          <p className="mt-2 text-sm text-slate-600">
            Quick CSV for this calendar month:{" "}
            <a
              href={`/api/reports/payments-csv?from=${encodeURIComponent(monthFrom)}&to=${encodeURIComponent(monthTo)}`}
              className="font-semibold text-[#1e5ea8] hover:underline"
            >
              {monthFrom} → {monthTo}
            </a>
            . Use the button below for the same range as the table.
          </p>
          <ReportsExportsExplorer mode="payments" canEditPayments={caps.canEditAppointments} className="mt-4" />
        </Card>
      ) : (
        <Card>
          <h3 className="text-xl font-semibold text-slate-900">Booking ↔ call link log</h3>
          <p className="mt-2 text-sm text-slate-600">
            Bookings are filtered by <span className="font-medium text-slate-800">start date</span>. Download CSV matches the
            date range you pick here.
          </p>
          <ReportsExportsExplorer mode="bookings" canEditPayments={false} className="mt-4" />
        </Card>
      )}
    </div>
  );
}
