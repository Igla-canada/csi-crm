import { format } from "date-fns";
import Link from "next/link";
import { CalendarClock, PhoneForwarded } from "lucide-react";

import { Card, SectionHeading } from "@/components/app-shell";
import { callResultBadgePresentation } from "@/lib/call-result-accents";
import { getCurrentUser } from "@/lib/auth";
import { getTasksQueue } from "@/lib/crm";
import { getUserCapabilities } from "@/lib/user-privileges";
import { redirect } from "next/navigation";

function formatWhen(d: Date) {
  return format(d, "MMM d, yyyy · h:mm a");
}

function formatAppointmentSlot(startAt: Date, endAt: Date) {
  const sameDay =
    startAt.getFullYear() === endAt.getFullYear() &&
    startAt.getMonth() === endAt.getMonth() &&
    startAt.getDate() === endAt.getDate();
  if (sameDay) {
    return `${format(startAt, "MMM d, yyyy · h:mm a")} – ${format(endAt, "h:mm a")}`;
  }
  return `${formatWhen(startAt)} → ${formatWhen(endAt)}`;
}

export default async function TasksPage() {
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  if (!caps.canViewTasks) {
    redirect("/");
  }
  const { callTasks, upcomingAppointments, googleCalendarNotice } = await getTasksQueue({
    googleRefreshToken: user.googleRefreshToken,
    googleCalendarId: user.googleCalendarId,
  });

  return (
    <div className="crm-grid">
      <SectionHeading
        eyebrow="Tasks"
        title="Callbacks & appointments"
        text="A simple job list: calls that need a callback or have a scheduled follow-up time, plus upcoming bookings from the CRM and — when your Google account is connected — Google Calendar events that are not already linked to a CRM appointment. Open CRM rows in the editor; Google-only rows open in Google Calendar."
      />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="rounded-[20px] bg-[#eaf2fb] p-3 text-[#1e5ea8]">
              <PhoneForwarded className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Call follow-ups</p>
              <h3 className="mt-1 text-[1.45rem] font-semibold tracking-tight text-slate-900">
                Callbacks & scheduled follow-ups
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Includes calls tied to a <span className="font-medium text-slate-800">client</span> with a{" "}
                <span className="font-medium text-slate-800">follow-up time</span>, result{" "}
                <span className="font-medium text-slate-800">Callback needed</span> /{" "}
                <span className="font-medium text-slate-800">Follow up</span>, or a{" "}
                <span className="font-medium text-slate-800">RingCentral</span> row that still needs a callback
                (voicemail / missed) once that number is linked to a client. Unassigned call history never appears here
                until you log the call. After you return the call, set the card to{" "}
                <span className="font-medium text-slate-800">Completed</span> or{" "}
                <span className="font-medium text-slate-800">Archived</span> and it leaves this list.
              </p>
            </div>
          </div>
          <Link
            href="/calls"
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1e5ea8] shadow-sm transition hover:bg-slate-50"
          >
            Log a call
          </Link>
        </div>

        <ul className="mt-6 space-y-3">
          {callTasks.length === 0 ? (
            <li className="crm-soft-row rounded-[22px] px-4 py-6 text-center text-sm text-slate-600">
              Nothing waiting — no open callbacks or follow-up times right now.
            </li>
          ) : (
            callTasks.map((call) => {
              const badge = callResultBadgePresentation(
                call.resultOption?.accentHex ?? null,
                call.resultOption?.accentKey ?? null,
                call.outcomeCode,
              );
              return (
                <li key={call.id}>
                  <Link
                    href={`/clients/${call.clientId}`}
                    className="crm-soft-row block rounded-[22px] p-4 transition hover:border-[#1e5ea8]/25 hover:shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900">{call.client?.displayName ?? "Client"}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-700">{call.summary}</p>
                        {call.telephonyCallbackPending && call.telephonyResult?.trim() ? (
                          <p className="mt-1 text-xs font-semibold text-rose-800">
                            RingCentral: {call.telephonyResult.trim()} — call back
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          {call.contactPhone ? (
                            <span className="rounded-lg bg-white/80 px-2 py-0.5 ring-1 ring-slate-200">
                              {call.contactPhone}
                            </span>
                          ) : null}
                          {call.vehicleText ? (
                            <span className="rounded-lg bg-white/80 px-2 py-0.5 ring-1 ring-slate-200">
                              {call.vehicleText}
                            </span>
                          ) : null}
                          {call.productQuoteLines.length ? (
                            <span className="rounded-lg bg-white/80 px-2 py-0.5 ring-1 ring-slate-200">
                              {call.productQuoteLines.map((l) => l.productDisplay).join(" · ")}
                            </span>
                          ) : call.product || call.productDisplay ? (
                            <span className="rounded-lg bg-white/80 px-2 py-0.5 ring-1 ring-slate-200">
                              {call.productDisplay ?? call.product}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className={badge.className} style={badge.style}>
                          {call.resultOption?.label ?? call.outcomeCode}
                        </span>
                        {call.followUpAt ? (
                          <span className="text-xs font-semibold text-amber-900">
                            Follow-up {formatWhen(call.followUpAt)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">No time set · touch base soon</span>
                        )}
                        <span className="text-[11px] text-slate-400">Call {formatWhen(call.happenedAt)}</span>
                      </div>
                    </div>
                    {call.callbackNotes?.trim() ? (
                      <p className="mt-3 border-t border-slate-200/80 pt-3 text-sm text-slate-600">
                        <span className="font-medium text-slate-800">Callback notes: </span>
                        {call.callbackNotes}
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="rounded-[20px] bg-[#f0fdf4] p-3 text-emerald-700">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Appointments</p>
              <h3 className="mt-1 text-[1.45rem] font-semibold tracking-tight text-slate-900">Upcoming bookings</h3>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Next 60 calendar days using the shop timezone (see <span className="font-medium">APP_TIMEZONE</span> in
                env, default America/Toronto). Lists CRM appointments plus Google-only events from the same source as
                Bookings — your Google login when connected, otherwise the shared calendar token in env. Linked CRM
                bookings are not duplicated. CRM rows show a green tag when a deposit is noted on the booking or a
                payment/deposit row exists under Deposits &amp; payments.
              </p>
              {googleCalendarNotice ? (
                <p
                  className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                  role="status"
                >
                  <span className="font-semibold">Google on Tasks: </span>
                  {googleCalendarNotice}
                </p>
              ) : null}
            </div>
          </div>
          <Link
            href="/appointments"
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1e5ea8] shadow-sm transition hover:bg-slate-50"
          >
            Calendar
          </Link>
        </div>

        <ul className="mt-6 space-y-3">
          {upcomingAppointments.length === 0 ? (
            <li className="crm-soft-row rounded-[22px] px-4 py-6 text-center text-sm text-slate-600">
              No upcoming appointments in this window.
            </li>
          ) : (
            upcomingAppointments.map((a) => {
              const isGoogle = a.source === "google";
              const statusLabel =
                isGoogle && a.status === "ALL_DAY" ? "All day" : isGoogle ? "Google" : a.status;
              const titleClass = "mt-1 block text-sm font-medium text-slate-800 hover:text-[#1e5ea8]";
              const timeClass = "text-xs font-semibold text-emerald-900 hover:underline";

              return (
                <li
                  key={a.id}
                  className={`crm-soft-row flex flex-wrap items-start justify-between gap-3 rounded-[22px] p-4 transition hover:shadow-sm ${
                    isGoogle ? "hover:border-[#1a73e8]/35" : "hover:border-emerald-300/40"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {isGoogle ? (
                      <span className="font-semibold text-slate-900">{a.clientDisplayName}</span>
                    ) : (
                      <Link
                        href={`/clients/${a.clientId}`}
                        className="font-semibold text-slate-900 hover:text-[#1e5ea8] hover:underline"
                      >
                        {a.clientDisplayName}
                      </Link>
                    )}
                    {isGoogle && a.googleHtmlLink ? (
                      <a href={a.googleHtmlLink} target="_blank" rel="noopener noreferrer" className={titleClass}>
                        {a.title}
                      </a>
                    ) : isGoogle ? (
                      <span className={`${titleClass} cursor-default hover:text-slate-800`}>{a.title}</span>
                    ) : (
                      <Link href={`/appointments/${a.id}/edit`} className={titleClass}>
                        {a.title}
                      </Link>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span
                        className={`rounded-lg px-2 py-0.5 ring-1 ring-slate-200 ${
                          isGoogle ? "bg-[#e8f5e9] text-[#1b5e20]" : "bg-white/80"
                        }`}
                      >
                        {a.typeLabel}
                      </span>
                      {a.resourceKey ? (
                        <span className="rounded-lg bg-white/80 px-2 py-0.5 ring-1 ring-slate-200">
                          {a.resourceKey}
                        </span>
                      ) : null}
                      {a.moneyTagLabel ? (
                        <span
                          className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[0.7rem] font-semibold text-emerald-950 ring-1 ring-emerald-200/90"
                          title="From booking deposit field and/or Deposits & payments"
                        >
                          {a.moneyTagLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                    <span className="crm-badge">{statusLabel}</span>
                    {isGoogle && a.googleHtmlLink ? (
                      <a
                        href={a.googleHtmlLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={isGoogle ? `${timeClass} text-[#1a73e8]` : timeClass}
                      >
                        {formatAppointmentSlot(a.startAt, a.endAt)}
                      </a>
                    ) : isGoogle ? (
                      <span className="text-xs font-semibold text-slate-700">
                        {formatAppointmentSlot(a.startAt, a.endAt)}
                      </span>
                    ) : (
                      <Link href={`/appointments/${a.id}/edit`} className={timeClass}>
                        {formatAppointmentSlot(a.startAt, a.endAt)}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </Card>
    </div>
  );
}
