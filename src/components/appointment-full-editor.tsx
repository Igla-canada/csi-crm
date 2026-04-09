"use client";

import { differenceInMinutes, endOfDay, format, parseISO, startOfDay } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { createAppointmentAction, updateAppointmentAction } from "@/app/actions";
import {
  BookingProductQuoteLines,
  serializeBookingQuoteLines,
  validateBookingQuoteLinesBeforeSubmit,
  type BookingQuoteLine,
  type ProductServiceOptionForBooking,
} from "@/components/booking-product-quote-lines";
import { BookingClientPickFields } from "@/components/booking-client-pick-fields";
import { BookingVehiclePickField } from "@/components/booking-vehicle-pick-field";
import { PaymentEventsPanel } from "@/components/payment-events-panel";
import {
  CALENDAR_ENTRY_KINDS,
  type AppointmentEditorModel,
  type AppointmentFormClientOption,
  type CalendarEntryKind,
  type PaymentEventView,
} from "@/lib/crm-types";
import { cn } from "@/lib/crm-shared";

const RESOURCE_OPTIONS = [
  { value: "front-desk", label: "Front desk" },
  { value: "bay-a", label: "Bay A" },
  { value: "diagnostics", label: "Diagnostics" },
] as const;

const RECURRENCE_OPTIONS = [
  { value: "", label: "Does not repeat" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function coerceDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

function toDatetimeLocal(d: Date | string): string {
  const x = coerceDate(d);
  if (Number.isNaN(x.getTime())) return "";
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

function toDateInput(d: Date | string): string {
  const x = coerceDate(d);
  if (Number.isNaN(x.getTime())) return "";
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

type Props = {
  mode: "create" | "edit";
  appointment?: AppointmentEditorModel;
  initialStart: Date;
  initialEnd: Date;
  /** Primary phone for the linked client (edit only) — avoids clearing client link when the phone field is empty. */
  initialClientPhone?: string;
  clients: AppointmentFormClientOption[];
  typeOptions: { code: string; label: string }[];
  googleConnected: boolean;
  calendarOwnerLabel: string;
  timeZoneLabel: string;
  /** Edit mode: payment rows for this booking (omit to hide the panel). */
  paymentEvents?: PaymentEventView[];
  canRecordPayments?: boolean;
  /** Create mode: product/quote lines (same as Log a call). */
  productServiceOptions?: ProductServiceOptionForBooking[];
};

export function AppointmentFullEditor({
  mode,
  appointment,
  initialStart,
  initialEnd,
  initialClientPhone = "",
  clients,
  typeOptions,
  googleConnected,
  calendarOwnerLabel,
  timeZoneLabel,
  paymentEvents,
  canRecordPayments = true,
  productServiceOptions = [],
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [entryKind, setEntryKind] = useState<CalendarEntryKind>(() => {
    const k = appointment?.calendarEntryKind;
    return k && (CALENDAR_ENTRY_KINDS as readonly string[]).includes(k)
      ? (k as CalendarEntryKind)
      : "APPOINTMENT_SCHEDULE";
  });

  const [title, setTitle] = useState(appointment?.title ?? "");
  const [allDay, setAllDay] = useState(Boolean(appointment?.allDay));
  const [startLocal, setStartLocal] = useState(() =>
    appointment ? toDatetimeLocal(appointment.startAt) : toDatetimeLocal(initialStart),
  );
  const [endLocal, setEndLocal] = useState(() =>
    appointment ? toDatetimeLocal(appointment.endAt) : toDatetimeLocal(initialEnd),
  );
  const [allDayDate, setAllDayDate] = useState(() =>
    appointment ? toDateInput(appointment.startAt) : toDateInput(initialStart),
  );

  const [clientId, setClientId] = useState(appointment?.clientId ?? "");
  const [clientPhone, setClientPhone] = useState(() =>
    mode === "edit" ? initialClientPhone : "",
  );
  const [clientDisplayName, setClientDisplayName] = useState(appointment?.client.displayName ?? "");
  const [vehicleId, setVehicleId] = useState(appointment?.vehicleId ?? "");
  const [vehicleText, setVehicleText] = useState(appointment?.vehicleLabel ?? "");
  const [type, setType] = useState(appointment?.type ?? typeOptions[0]?.code ?? "");
  const [resourceKey, setResourceKey] = useState(appointment?.resourceKey ?? "front-desk");
  const [location, setLocation] = useState(appointment?.location ?? "");
  const [guestEmails, setGuestEmails] = useState(appointment?.guestEmails ?? "");
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [recurrenceRule, setRecurrenceRule] = useState(appointment?.recurrenceRule ?? "");
  const [showAs, setShowAs] = useState<"busy" | "free">(
    appointment?.showAs === "free" ? "free" : "busy",
  );
  const [quoteLines, setQuoteLines] = useState<BookingQuoteLine[]>([{ product: "", priceText: "" }]);

  const [visibility, setVisibility] = useState<
    "default" | "public" | "private" | "confidential"
  >(
    appointment?.visibility === "public" ||
      appointment?.visibility === "private" ||
      appointment?.visibility === "confidential"
      ? (appointment.visibility as "public" | "private" | "confidential")
      : "default",
  );

  const vehicles = useMemo(() => clients.find((x) => x.id === clientId)?.vehicles ?? [], [clients, clientId]);

  const skipClientVehicleReset = useRef(true);
  useEffect(() => {
    if (skipClientVehicleReset.current) {
      skipClientVehicleReset.current = false;
      return;
    }
    setVehicleId("");
    setVehicleText("");
  }, [clientId]);

  const submit = () => {
    setError(null);
    if (!clientId && clientDisplayName.trim().length < 2) {
      setError("Enter a client name (at least 2 characters) or pick a matching client.");
      return;
    }
    if (title.trim().length < 4) {
      setError("Title must be at least 4 characters.");
      return;
    }
    if (!type || !typeOptions.some((o) => o.code === type)) {
      setError("Choose a booking type.");
      return;
    }

    if (mode === "create" && !validateBookingQuoteLinesBeforeSubmit()) {
      return;
    }

    let startAt: Date;
    let endAt: Date;
    if (allDay) {
      const d = parseISO(`${allDayDate}T12:00:00`);
      startAt = startOfDay(d);
      endAt = endOfDay(d);
    } else {
      startAt = new Date(startLocal);
      endAt = new Date(endLocal);
      if (endAt.getTime() <= startAt.getTime()) {
        setError("End time must be after start time.");
        return;
      }
    }

    const fd = new FormData();
    if (mode === "edit" && appointment) {
      fd.set("appointmentId", appointment.id);
    }
    if (clientId) fd.set("clientId", clientId);
    else {
      fd.set("newClientDisplayName", clientDisplayName.trim());
      fd.set("newClientPhone", clientPhone.trim());
    }
    fd.set("vehicleId", vehicleId);
    fd.set("newVehicleLabel", vehicleText.trim());
    fd.set("title", title.trim());
    fd.set("type", type);
    fd.set("startAt", startAt.toISOString());
    if (allDay) {
      fd.set("allDay", "true");
      fd.set("durationMins", String(Math.max(15, differenceInMinutes(endAt, startAt))));
    } else {
      fd.set("allDay", "false");
      fd.set("durationMins", String(Math.max(15, differenceInMinutes(endAt, startAt))));
    }
    if (mode === "edit") {
      fd.set("endAt", endAt.toISOString());
    }
    fd.set("resourceKey", resourceKey);
    // Deposits are recorded in "Payments for this booking" below; preserve legacy depositText on edit.
    if (mode === "edit" && appointment) {
      fd.set("depositText", (appointment.depositText ?? "").trim());
    } else {
      fd.set("depositText", "");
    }
    fd.set("notes", notes);
    fd.set("calendarEntryKind", entryKind);
    fd.set("location", location);
    fd.set("guestEmails", guestEmails);
    fd.set("recurrenceRule", recurrenceRule);
    fd.set("showAs", showAs);
    fd.set("visibility", visibility);

    if (mode === "create") {
      fd.set("productQuoteLinesJson", serializeBookingQuoteLines(quoteLines));
    }

    startTransition(async () => {
      try {
        if (mode === "edit") {
          await updateAppointmentAction(fd);
        } else {
          await createAppointmentAction(fd);
        }
        router.push("/appointments");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  };

  const input =
    "w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2.5 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]";

  return (
    <div className="min-h-screen bg-[#f8f9fa] pb-16 pt-4">
      <div className="mx-auto max-w-3xl px-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link
            href="/appointments"
            className="text-sm font-medium text-[#1a73e8] hover:underline"
          >
            ← Back to calendar
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className={cn(
              "rounded-lg bg-[#1a73e8] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1765cc]",
              pending && "opacity-60",
            )}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="rounded-2xl border border-[#dadce0] bg-white p-6 shadow-sm">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add title"
            className="mb-4 w-full border-0 border-b-2 border-transparent border-b-[#1a73e8] bg-transparent pb-2 text-2xl font-normal text-[#3c4043] outline-none placeholder:text-[#70757a] focus:border-b-[#1a73e8]"
          />

          <div className="mb-6 flex flex-wrap gap-2">
            {(
              [
                ["EVENT", "Event"],
                ["TASK", "Task"],
                ["APPOINTMENT_SCHEDULE", "Appointment schedule"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setEntryKind(k)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition",
                  entryKind === k
                    ? "bg-[#e8f0fe] text-[#1967d2]"
                    : "text-[#5f6368] hover:bg-[#f1f3f4]",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {entryKind === "APPOINTMENT_SCHEDULE" ? (
            <div className="mb-6 rounded-xl border border-[#dadce0] bg-[#f8f9fa] px-4 py-3 text-sm leading-relaxed text-[#5f6368]">
              This booking is tagged as an <strong className="text-[#3c4043]">appointment schedule</strong> in your
              CRM (shared booking page flows can be wired later). Client-facing types and colors still come from{" "}
              <strong>Workspace → Booking types</strong>.
            </div>
          ) : null}

          {entryKind === "TASK" ? (
            <p className="mb-6 text-sm text-[#5f6368]">
              Tasks sync to Google Calendar as <strong>free</strong> time by default so your availability stays open,
              with a <strong>[Task]</strong> prefix on the title in Google.
            </p>
          ) : null}

          <div className="space-y-5">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm text-[#3c4043]">All day</span>
            </label>

            {allDay ? (
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Date</span>
                <input
                  type="date"
                  value={allDayDate}
                  onChange={(e) => setAllDayDate(e.target.value)}
                  className={cn("mt-1", input)}
                />
              </label>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Starts</span>
                  <input
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    className={cn("mt-1", input)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Ends</span>
                  <input
                    type="datetime-local"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                    className={cn("mt-1", input)}
                  />
                </label>
              </div>
            )}

            <p className="text-xs text-[#70757a]">
              Time zone: <span className="font-medium text-[#5f6368]">{timeZoneLabel}</span> (app default — matches
              Google event time zone when syncing)
            </p>

            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Recurrence</span>
              <select
                value={recurrenceRule}
                onChange={(e) => setRecurrenceRule(e.target.value)}
                className={cn("mt-1", input)}
              >
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value || "none"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <BookingClientPickFields
              clients={clients}
              clientId={clientId}
              onClientIdChange={(id) => {
                setClientId(id);
              }}
              phone={clientPhone}
              onPhoneChange={setClientPhone}
              displayName={clientDisplayName}
              onDisplayNameChange={setClientDisplayName}
            />

            <BookingVehiclePickField
              vehicles={clientId ? vehicles : []}
              vehicleId={vehicleId}
              vehicleText={vehicleText}
              onVehicleIdChange={setVehicleId}
              onVehicleTextChange={setVehicleText}
            />

            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Booking type</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                disabled={typeOptions.length === 0}
                className={cn("mt-1", input, "disabled:bg-[#f1f3f4]")}
              >
                {typeOptions.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Resource</span>
              <select
                value={resourceKey}
                onChange={(e) => setResourceKey(e.target.value)}
                className={cn("mt-1", input)}
              >
                {RESOURCE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            {mode === "edit" && appointment?.linkedCall ? (
              <div className="rounded-xl border border-[#dadce0] bg-[#e8f0fe] px-4 py-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#1967d2]">Linked call</p>
                <p className="mt-1 text-[#3c4043]">{format(appointment.linkedCall.happenedAt, "MMM d, yyyy · h:mm a")}</p>
                <p className="mt-1 line-clamp-2 text-[#5f6368]">{appointment.linkedCall.summary || "—"}</p>
                <Link
                  href={`/clients/${appointment.clientId}#call-log-${appointment.linkedCall.id}`}
                  className="mt-2 inline-block text-sm font-semibold text-[#1967d2] hover:underline"
                >
                  Open client timeline
                </Link>
              </div>
            ) : null}

            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Location</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Add location"
                className={cn("mt-1", input)}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Guests (emails)</span>
              <textarea
                value={guestEmails}
                onChange={(e) => setGuestEmails(e.target.value)}
                placeholder="Comma or line separated"
                rows={2}
                className={cn("mt-1 resize-none", input)}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Description / notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add description"
                rows={4}
                className={cn("mt-1 resize-none", input)}
              />
            </label>

            {mode === "create" ? (
              <BookingProductQuoteLines
                productOptions={productServiceOptions}
                lines={quoteLines}
                onLinesChange={setQuoteLines}
              />
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Show as</span>
                <select
                  value={showAs}
                  onChange={(e) => setShowAs(e.target.value as "busy" | "free")}
                  className={cn("mt-1", input)}
                >
                  <option value="busy">Busy</option>
                  <option value="free">Free</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Visibility</span>
                <select
                  value={visibility}
                  onChange={(e) =>
                    setVisibility(
                      e.target.value as "default" | "public" | "private" | "confidential",
                    )
                  }
                  className={cn("mt-1", input)}
                >
                  <option value="default">Default visibility</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="confidential">Confidential</option>
                </select>
              </label>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-[#dadce0] bg-[#f8f9fa] px-4 py-3">
              <div className="mt-0.5 h-3 w-3 shrink-0 rounded-full bg-[#0f9d58]" aria-hidden />
              <div>
                <p className="text-sm font-medium text-[#3c4043]">{calendarOwnerLabel}</p>
                <p className="text-xs text-[#5f6368]">
                  {googleConnected
                    ? "Changes save to the CRM and push to this Google calendar when linked."
                    : "Connect Google in Workspace to sync this booking to your calendar."}
                </p>
              </div>
            </div>

            <p className="text-xs text-[#70757a]">
              Notifications: Google uses your calendar&apos;s default reminder settings for synced events.
            </p>

            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </div>

        {mode === "edit" && appointment && paymentEvents !== undefined ? (
          <PaymentEventsPanel
            clientId={appointment.clientId}
            lockAppointmentId={appointment.id}
            defaultCallLogId={appointment.callLogId}
            initialEvents={paymentEvents}
            readOnly={!canRecordPayments}
            title="Payments for this booking"
            className="mt-6"
          />
        ) : null}
      </div>
    </div>
  );
}
