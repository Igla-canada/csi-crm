import { notFound } from "next/navigation";
import { format } from "date-fns";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { CallLogTimelineCard } from "@/components/call-log-timeline-card";
import { ClientDetailTabNav } from "@/components/client-detail-tab-nav";
import { LiveCallLogScrollTarget } from "@/components/live-call-log-scroll-target";
import { ScrollToOpenCallLog } from "@/components/scroll-to-open-call-log";
import { LogCallForm } from "@/components/log-call-form";
import { PaymentEventsPanel } from "@/components/payment-events-panel";
import { Card, SectionHeading } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { normalizeStoredAccentHex } from "@/lib/call-result-accents";
import {
  getCallResultOptions,
  getClientDetail,
  getLeadSourceOptions,
  getProductServiceOptions,
  listPaymentEventsForClient,
} from "@/lib/crm";
import { paymentBadgeLabelForAppointment, paymentBadgeLabelForCall } from "@/lib/payment-badges";
import { parseCallDirectionSearchParam } from "@/lib/call-direction-search-param";
import { normalizePhone } from "@/lib/phone";
import { getAppTimezone } from "@/lib/google-calendar/env";
import { formatShopDateShort, formatShopDateTime } from "@/lib/shop-datetime-format";
import { getTorontoNowDatetimeLocalValue } from "@/lib/toronto-datetime-input";
import { getUserCapabilities } from "@/lib/user-privileges";

type ClientPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    tab?: string;
    liveLog?: string;
    phone?: string;
    contactName?: string;
    direction?: string;
    openCallLog?: string;
  }>;
};

function phonesMatch(a?: string | null, b?: string | null) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return Boolean(na && nb && na === nb);
}

function showCallPhoneOnRow(callPhone: string | null | undefined, primaryPhone: string | null | undefined) {
  if (!callPhone?.trim()) return false;
  return !phonesMatch(callPhone, primaryPhone);
}

function showCallNameOnRow(callName: string | null | undefined, clientDisplayName: string) {
  if (!callName?.trim()) return false;
  return callName.trim().toLowerCase() !== clientDisplayName.trim().toLowerCase();
}

export default async function ClientDetailPage({ params, searchParams }: ClientPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const {
    tab: tabRaw,
    liveLog,
    phone: livePhone,
    contactName: liveContactName,
    direction: liveDirection,
    openCallLog: openCallLogRaw,
  } = sp;
  const tab = tabRaw === "payments" ? "payments" : "overview";

  const [
    client,
    callResultOptionsRaw,
    productServiceOptionsRaw,
    leadSourceOptionsRaw,
    logCallResultOptionsRaw,
    logProductServiceOptionsRaw,
    logLeadSourceOptionsRaw,
    paymentEvents,
    currentUser,
  ] = await Promise.all([
    getClientDetail(id),
    getCallResultOptions(false),
    getProductServiceOptions(false),
    getLeadSourceOptions(false),
    getCallResultOptions(true),
    getProductServiceOptions(true),
    getLeadSourceOptions(true),
    listPaymentEventsForClient(id),
    getCurrentUser(),
  ]);
  const caps = getUserCapabilities(currentUser);

  if (!client) {
    notFound();
  }

  const shopTz = getAppTimezone();

  const openCallLogCandidate = openCallLogRaw?.trim() ?? "";
  const openCallLogId =
    openCallLogCandidate && client.callLogs.some((c) => c.id === openCallLogCandidate)
      ? openCallLogCandidate
      : null;

  const showLiveLogCard = liveLog === "1" && caps.canLogCalls && tab === "overview";
  const liveLogPrefill = showLiveLogCard
    ? {
        phone: livePhone?.trim() || undefined,
        contactName: liveContactName?.trim() || undefined,
        direction: parseCallDirectionSearchParam(liveDirection),
      }
    : null;
  const defaultTorontoTime = getTorontoNowDatetimeLocalValue();

  const logCallResultOptionsDto = logCallResultOptionsRaw.map((o) => ({
    code: o.code as string,
    label: o.label as string,
    active: Boolean(o.active),
    accentKey: (o as { accentKey?: string }).accentKey ?? null,
    accentHex: (o as { accentHex?: string | null }).accentHex ?? null,
  }));

  const logProductServiceOptionsDto = logProductServiceOptionsRaw.map((o) => ({
    code: String(o.code),
    label: String(o.label),
    matchTerms: String((o as { matchTerms?: string }).matchTerms ?? ""),
    active: Boolean(o.active),
  }));

  const logLeadSourceOptionsDto = logLeadSourceOptionsRaw.map((o) => ({
    code: String(o.code),
    label: String(o.label),
    active: Boolean(o.active),
  }));

  const callResultOptionsDto = callResultOptionsRaw.map((o) => ({
    code: o.code as string,
    label: o.label as string,
    active: Boolean(o.active),
    accentKey: (o as { accentKey?: string }).accentKey ?? null,
    accentHex: (o as { accentHex?: string | null }).accentHex ?? null,
  }));

  const productServiceOptionsDto = productServiceOptionsRaw.map((o) => ({
    code: String(o.code),
    label: String(o.label),
    matchTerms: String((o as { matchTerms?: string }).matchTerms ?? ""),
    active: Boolean(o.active),
  }));

  const leadSourceOptionsDto = leadSourceOptionsRaw.map((o) => ({
    code: String(o.code),
    label: String(o.label),
    active: Boolean(o.active),
  }));

  const primaryPhone =
    client.contactPoints.find((p) => p.kind === "PHONE" && p.isPrimary)?.value ??
    client.contactPoints.find((p) => p.kind === "PHONE")?.value;
  const primaryEmail = client.contactPoints.find((p) => p.kind === "EMAIL")?.value;
  const primaryEmailLower = primaryEmail?.trim().toLowerCase() ?? "";

  const extraContacts = client.contactPoints.filter((p) => {
    if (p.kind === "PHONE") {
      return !phonesMatch(p.value, primaryPhone);
    }
    if (p.kind === "EMAIL") {
      return p.value.trim().toLowerCase() !== primaryEmailLower;
    }
    return true;
  });

  const vehicleLabels = client.vehicles.map((v) => v.label);
  const lastCall = client.callLogs[0];

  return (
    <div className="crm-grid">
      <div>
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#1e5ea8] hover:text-[#17497f]"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to clients
        </Link>
      </div>

      <SectionHeading
        eyebrow="Client card"
        title={client.displayName}
        text={
          tab === "payments"
            ? "Log deposits and payments for reconciliation. Export CSVs under Reports when you need a wider view."
            : "Profile lives in one place above. Call history focuses on what changed on each call — we skip repeating the same phone and name when they match this customer."
        }
        aside={
          <div className="flex flex-col items-end gap-1 text-right text-sm text-slate-600">
            <p>
              <span className="font-semibold text-slate-900">{client.callLogs.length}</span> call
              {client.callLogs.length === 1 ? "" : "s"} on file
            </p>
            {lastCall ? (
              <p className="text-xs text-slate-500">
                Last call: {formatShopDateShort(lastCall.happenedAt, shopTz)}
              </p>
            ) : null}
          </div>
        }
      />

      <ClientDetailTabNav clientId={client.id} active={tab} paymentsCount={paymentEvents.length} />

      {tab === "payments" ? (
        <div className="max-w-3xl">
          <PaymentEventsPanel
            clientId={client.id}
            initialEvents={paymentEvents}
            readOnly={!caps.canEditAppointments}
            appointmentChoices={client.appointments.map((a) => ({
              id: a.id,
              label: `${a.title} · ${format(a.startAt, "MMM d, yyyy")}`,
            }))}
          />
        </div>
      ) : (
        <>
          <ScrollToOpenCallLog callLogId={tab === "overview" ? openCallLogId : null} />
          {showLiveLogCard ? (
            <LiveCallLogScrollTarget>
              <Card>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Live call</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-900">Log this call</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Phone and caller ID came from RingCentral. Fill in the summary and result while you are on the line,
                  then save.
                </p>
                <LogCallForm
                  defaultHappenedAt={defaultTorontoTime}
                  callResultOptions={logCallResultOptionsDto}
                  productServiceOptions={logProductServiceOptionsDto}
                  leadSourceOptions={logLeadSourceOptionsDto}
                  liveLogPrefill={liveLogPrefill}
                  fixedClientId={client.id}
                />
              </Card>
            </LiveCallLogScrollTarget>
          ) : null}

          <Card>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Customer snapshot</p>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
              {primaryPhone ? (
                <p>
                  <span className="text-slate-500">Phone </span>
                  <span className="font-semibold text-slate-900">{primaryPhone}</span>
                </p>
              ) : (
                <p className="text-slate-500">No phone on file</p>
              )}
              {primaryEmail ? (
                <p>
                  <span className="text-slate-500">Email </span>
                  <span className="font-semibold text-slate-900">{primaryEmail}</span>
                </p>
              ) : null}
              {client.source ? (
                <p>
                  <span className="text-slate-500">Source </span>
                  <span className="font-semibold text-slate-900">{client.source}</span>
                </p>
              ) : null}
              {client.companyName ? (
                <p>
                  <span className="text-slate-500">Company </span>
                  <span className="font-semibold text-slate-900">{client.companyName}</span>
                </p>
              ) : null}
            </div>

            {client.tags ? (
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-500">Tags</p>
                <p className="mt-1 text-sm text-slate-800">{client.tags}</p>
              </div>
            ) : null}

            {vehicleLabels.length ? (
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-500">Vehicles</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{vehicleLabels.join(" · ")}</p>
              </div>
            ) : null}

            {extraContacts.length ? (
              <div className="mt-4 border-t border-slate-200/80 pt-4">
                <p className="text-xs font-medium text-slate-500">Additional contacts</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-800">
                  {extraContacts.map((p) => (
                    <li key={p.id}>
                      <span className="text-slate-500">{p.kind}: </span>
                      {p.value}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 border-t border-slate-200/80 pt-4">
              <p className="text-xs font-medium text-slate-500">Internal notes</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">{client.notes || "None yet."}</p>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">Call history</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Newest first. Each call is a card on the timeline — use{" "}
                  <strong className="font-semibold text-slate-800">Edit</strong> to change the call result, clear follow-up
                  when it&apos;s done, or fix any field.                   Use the dropdown on each card for a quick result change. Manage{" "}
                  call result labels in{" "}
                  <Link href="/settings?tab=status" className="font-semibold text-[#1e5ea8] hover:underline">
                    Workspace → Status
                  </Link>{" "}
                  and lead sources in{" "}
                  <Link href="/settings?tab=lead-sources" className="font-semibold text-[#1e5ea8] hover:underline">
                    Lead sources
                  </Link>
                  . A green tag appears when a deposit or payment is on file for that call or its linked booking.
                </p>
              </div>
            </div>

            <div className="relative mt-6">
              {client.callLogs.length ? (
                <>
                  <div
                    className="absolute left-[15px] top-6 bottom-6 w-px bg-gradient-to-b from-[#b8d4ef] via-[#dce8f4] to-[#b8d4ef]"
                    aria-hidden
                  />
                  <ul className="relative z-0 m-0 list-none space-y-6 p-0">
                    {client.callLogs.map((call) => {
                      const showPhoneRow = showCallPhoneOnRow(call.contactPhone, primaryPhone);
                      const showNameRow = showCallNameOnRow(call.contactName, client.displayName);
                      const linkedApt = client.appointments.find((a) => a.callLogId === call.id) ?? null;
                      const linkedAppointment = linkedApt
                        ? {
                            id: linkedApt.id,
                            title: linkedApt.title,
                            startAtLabel: formatShopDateTime(linkedApt.startAt, shopTz),
                          }
                        : null;
                      const paymentBadgeLabel = paymentBadgeLabelForCall(
                        call.id,
                        linkedApt?.id ?? null,
                        paymentEvents,
                      );

                      return (
                        <CallLogTimelineCard
                          key={call.id}
                          clientId={client.id}
                          showPhoneRow={showPhoneRow}
                          showNameRow={showNameRow}
                          linkedAppointment={linkedAppointment}
                          paymentBadgeLabel={paymentBadgeLabel}
                          resultOptions={callResultOptionsDto}
                          productServiceOptions={productServiceOptionsDto}
                          leadSourceOptions={leadSourceOptionsDto}
                          canRequestTranscription={caps.canConfigure || caps.canEditCallLogs}
                          canSyncRingCentralCallLog={caps.canConfigure || caps.canEditCallLogs}
                          /** Deep link from Call history: stay in read mode so recording + speed controls show (edit hides them). */
                          initialEditOpen={false}
                          snapshot={{
                            id: call.id,
                            happenedAtIso: call.happenedAt.toISOString(),
                            followUpAtIso: call.followUpAt?.toISOString() ?? null,
                            happenedAtLabel: formatShopDateTime(call.happenedAt, shopTz),
                            followUpAtLabel: call.followUpAt ? formatShopDateTime(call.followUpAt, shopTz) : null,
                            loggedByName: call.user.name,
                            direction: call.direction,
                            outcomeCode: call.outcomeCode,
                            outcomeLabel: call.resultOption?.label ?? call.outcomeCode,
                            outcomeAccentHex: normalizeStoredAccentHex(call.resultOption?.accentHex),
                            outcomeStoredAccentKey: call.resultOption?.accentKey ?? null,
                            summary: call.summary,
                            contactPhone: call.contactPhone ?? "",
                            contactName: call.contactName ?? "",
                            vehicleText: call.vehicleText ?? "",
                            product: call.product ?? "",
                            productDisplay: call.productDisplay ?? call.product ?? "",
                            priceText: call.priceText,
                            priceDigits: (call.priceText || "").replace(/\D/g, ""),
                            source: call.source ?? "",
                            sourceDisplay: call.sourceDisplay ?? call.source ?? "",
                            callbackNotes: call.callbackNotes ?? "",
                            internalNotes: call.internalNotes ?? "",
                            productQuoteLines:
                              call.productQuoteLines.length > 0
                                ? call.productQuoteLines.map((l) => ({
                                    productDisplay: l.productDisplay,
                                    priceText: l.priceText,
                                    priceDigits: (l.priceText || "").replace(/\D/g, ""),
                                  }))
                                : call.product || call.priceText
                                  ? [
                                      {
                                        productDisplay: call.productDisplay ?? call.product ?? "",
                                        priceText: call.priceText,
                                        priceDigits: (call.priceText || "").replace(/\D/g, ""),
                                      },
                                    ]
                                  : [],
                            telephonyDraft: call.telephonyDraft,
                            ...(() => {
                              const refCount = call.telephonyRecordingRefs?.length ?? 0;
                              const hasLegacyUri = Boolean(call.telephonyRecordingContentUri?.trim());
                              const segmentCount = refCount > 0 ? refCount : hasLegacyUri ? 1 : 0;
                              return {
                                hasTelephonyRecording: segmentCount > 0,
                                telephonyRecordingSegmentCount: segmentCount > 0 ? segmentCount : undefined,
                              };
                            })(),
                            telephonyTranscript: call.telephonyTranscript,
                            telephonyAiSummary: call.telephonyAiSummary,
                            telephonyAiPending:
                              Boolean(call.telephonyAiJobId?.trim()) || call.telephonyGeminiPending,
                            telephonyGeminiStructured: call.telephonyGeminiStructured,
                            telephonyResult: call.telephonyResult,
                            telephonyCallbackPending: call.telephonyCallbackPending,
                            ringCentralCallLogId: call.ringCentralCallLogId,
                          }}
                        />
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="pl-2 text-sm text-slate-600">No calls logged yet.</p>
              )}
            </div>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card>
              <h3 className="text-xl font-semibold text-slate-900">Opportunities</h3>
              <div className="mt-6 space-y-4">
                {client.opportunities.length ? (
                  client.opportunities.map((opportunity) => (
                    <div key={opportunity.id} className="crm-soft-row rounded-[22px] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-slate-900">
                          {opportunity.productDisplay ?? opportunity.product}
                        </p>
                        <span className="crm-badge">{opportunity.status}</span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{opportunity.summary || "No summary"}</p>
                      {opportunity.estimateText ? (
                        <p className="crm-blue-accent mt-3 text-sm">{opportunity.estimateText}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No opportunities on file.</p>
                )}
              </div>
            </Card>

            <Card>
              <h3 className="text-xl font-semibold text-slate-900">Appointments</h3>
              <p className="mt-2 text-sm text-slate-500">
                Bookings created from the calendar are tied to this client when you pick them in the booking dialog (or
                create a new client there). Open a row to edit times and details. A green tag shows when a deposit or
                payment row exists for that booking.
              </p>
              <div className="mt-6 space-y-4">
                {client.appointments.length ? (
                  client.appointments.map((appointment) => {
                    const aptPaymentLabel = paymentBadgeLabelForAppointment(appointment.id, paymentEvents);
                    return (
                      <div key={appointment.id} className="crm-soft-row rounded-[22px] p-4">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 gap-y-1">
                              <p className="font-semibold text-slate-900">{appointment.title}</p>
                              {aptPaymentLabel ? (
                                <span
                                  className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-950 ring-1 ring-emerald-200/90"
                                  title="Recorded under Deposits & payments"
                                >
                                  {aptPaymentLabel}
                                </span>
                              ) : null}
                            </div>
                            <p className="crm-blue-accent mt-1 text-xs uppercase tracking-[0.18em]">
                              {appointment.type} · {appointment.status}
                            </p>
                            {appointment.vehicleLabel ? (
                              <p className="mt-2 text-sm text-slate-600">
                                <span className="text-slate-500">Vehicle </span>
                                {appointment.vehicleLabel}
                              </p>
                            ) : null}
                            {appointment.resourceKey ? (
                              <p className="mt-1 text-sm text-slate-600">
                                <span className="text-slate-500">Resource </span>
                                {appointment.resourceKey.replace(/-/g, " ")}
                              </p>
                            ) : null}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-medium text-slate-700">
                              {format(appointment.startAt, "MMM d, yyyy")}
                            </p>
                            <p className="text-sm text-slate-500">
                              {format(appointment.startAt, "h:mm a")} – {format(appointment.endAt, "h:mm a")}
                            </p>
                            <Link
                              href={`/appointments/${appointment.id}/edit`}
                              className="mt-2 inline-block text-sm font-medium text-[#1e5ea8] hover:text-[#17497f]"
                            >
                              Edit booking
                            </Link>
                          </div>
                        </div>
                        <p className="mt-3 text-sm text-slate-600">{appointment.notes || "No notes"}</p>
                        {appointment.depositText?.trim() ? (
                          <p className="mt-2 text-sm font-semibold text-emerald-900">
                            Deposit:{" "}
                            {/^\d+$/.test(appointment.depositText.trim())
                              ? `$${appointment.depositText.trim()}`
                              : appointment.depositText.trim()}
                          </p>
                        ) : null}
                        {appointment.callLogId ? (
                          <p className="mt-2 text-sm text-slate-600">
                            <span className="text-slate-500">From call </span>
                            <Link
                              href={`/clients/${client.id}#call-log-${appointment.callLogId}`}
                              className="font-medium text-[#1e5ea8] hover:text-[#17497f]"
                            >
                              view in timeline
                            </Link>
                          </p>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">No appointments on file yet.</p>
                )}
              </div>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
