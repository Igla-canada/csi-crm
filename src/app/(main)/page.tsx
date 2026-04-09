import { format } from "date-fns";
import { PhoneCall } from "lucide-react";
import Link from "next/link";

import { Card, SectionHeading } from "@/components/app-shell";
import { DashboardAppointmentsCard } from "@/components/dashboard-appointments-card";
import { getCurrentUser } from "@/lib/auth";
import { callResultBadgePresentation } from "@/lib/call-result-accents";
import {
  getDashboardData,
} from "@/lib/crm";
import { roleColors } from "@/lib/crm-shared";

export default async function Home() {
  const [dashboard, currentUser] = await Promise.all([
    getDashboardData(),
    getCurrentUser(),
  ]);
  const recentCalls = dashboard.recentCalls.slice(0, 5);
  const overviewAppointments = dashboard.appointments.map((a) => ({
    id: a.id,
    title: a.title,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    resourceKey: a.resourceKey,
    clientDisplayName: a.client.displayName,
  }));

  return (
    <div className="crm-grid">
      <SectionHeading
        eyebrow="Overview"
        title="Today at a glance"
        text="Upcoming appointments, recent calls, and the callback numbers the team needs to stay on top of every day."
        aside={
          <div className={`inline-flex rounded-full px-4 py-2 text-xs font-semibold ring-1 ${roleColors[currentUser.role]}`}>
            {currentUser.role} active
          </div>
        }
      />

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <DashboardAppointmentsCard appointments={overviewAppointments} />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="rounded-[20px] bg-[#eaf2fb] p-3 text-[#1e5ea8]">
                <PhoneCall className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Call stats</p>
                <h3 className="mt-1 text-[1.55rem] font-semibold tracking-tight text-slate-900">Recent call activity</h3>
              </div>
            </div>
            <Link href="/clients" className="text-sm font-medium text-[#1e5ea8] hover:text-[#17497f]">
              Open calls
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="crm-soft-row rounded-[22px] p-4">
              <p className="text-sm text-slate-500">Calls logged</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{dashboard.totals.callsLogged}</p>
              <p className="mt-1 text-xs text-slate-400">Last 7 days</p>
            </div>
            <div className="crm-soft-row rounded-[22px] p-4">
              <p className="text-sm text-slate-500">Callbacks due</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{dashboard.totals.dueTodayCallbacks}</p>
              <p className="mt-1 text-xs text-slate-400">Follow-up time today</p>
            </div>
            <Link
              href="/tasks"
              className="crm-soft-row block rounded-[22px] p-4 transition hover:ring-1 hover:ring-[#1e5ea8]/20"
            >
              <p className="text-sm text-slate-500">Waiting follow-up</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{dashboard.totals.pendingCallbacks}</p>
              <p className="mt-1 text-xs text-slate-400">Matches Tasks call list</p>
              <p className="mt-0.5 text-xs font-medium text-[#1e5ea8]">Tasks →</p>
            </Link>
            <div className="crm-soft-row rounded-[22px] p-4">
              <p className="text-sm text-slate-500">Booked calls</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{dashboard.totals.bookedCalls}</p>
              <p className="mt-1 text-xs text-slate-400">Last 7 days</p>
            </div>
            <div className="crm-soft-row rounded-[22px] p-4">
              <p className="text-sm text-slate-500">Support calls</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{dashboard.totals.supportCalls}</p>
              <p className="mt-1 text-xs text-slate-400">Last 7 days</p>
            </div>
          </div>
        </Card>
      </section>

      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Recent calls</p>
            <h3 className="mt-1 text-[1.55rem] font-semibold tracking-tight text-slate-900">Last calls added to the CRM</h3>
          </div>
          <div className="flex gap-3 text-sm">
            <Link href="/calls" className="font-medium text-slate-600 hover:text-slate-900">
              Log call
            </Link>
            <Link href="/appointments" className="font-medium text-slate-600 hover:text-slate-900">
              Bookings
            </Link>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {recentCalls.length ? (
            recentCalls.map((call) => {
              const outcomeBadge = callResultBadgePresentation(
                call.resultOption?.accentHex,
                call.resultOption?.accentKey,
                call.outcomeCode,
              );
              return (
              <div
                key={call.id}
                className="crm-soft-row grid gap-3 rounded-[22px] p-4 md:grid-cols-[140px_1fr_auto]"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{format(call.happenedAt, "MMM d")}</p>
                  <p className="text-sm text-slate-500">{format(call.happenedAt, "h:mm a")}</p>
                </div>
                <div>
                  <p className="font-medium text-slate-900">{call.client.displayName}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{call.summary}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {[
                      call.contactPhone,
                      call.vehicleText,
                      call.productQuoteLines.length
                        ? call.productQuoteLines.map((l) => l.productDisplay).join(" · ")
                        : (call.productDisplay ?? call.product),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="text-left md:text-right">
                  <p className={outcomeBadge.className} style={outcomeBadge.style}>
                    {call.resultOption?.label ?? call.outcomeCode}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">{call.user.name}</p>
                </div>
              </div>
            );
            })
          ) : (
            <div className="crm-soft-row rounded-[22px] p-4 text-sm text-slate-600">
              No calls logged yet.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
