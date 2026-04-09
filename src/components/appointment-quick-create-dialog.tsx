"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createAppointmentAction } from "@/app/actions";
import {
  BookingProductQuoteLines,
  serializeBookingQuoteLines,
  validateBookingQuoteLinesBeforeSubmit,
  type BookingQuoteLine,
  type ProductServiceOptionForBooking,
} from "@/components/booking-product-quote-lines";
import { BookingClientPickFields } from "@/components/booking-client-pick-fields";
import { BookingVehiclePickField } from "@/components/booking-vehicle-pick-field";
import type { BookingFromCallPayload } from "@/lib/booking-from-call";
import type { AppointmentFormClientOption, CalendarEntryKind } from "@/lib/crm-types";
import { cn } from "@/lib/crm-shared";

function matchVehicleIdForPrefill(
  clients: AppointmentFormClientOption[],
  clientId: string,
  vehicleText: string,
): string {
  const t = vehicleText.trim().toLowerCase();
  if (!t || !clientId) return "";
  const list = clients.find((c) => c.id === clientId)?.vehicles ?? [];
  const hit = list.find((v) => v.label.trim().toLowerCase() === t);
  return hit?.id ?? "";
}

const RESOURCE_OPTIONS = [
  { value: "front-desk", label: "Front desk" },
  { value: "bay-a", label: "Bay A" },
  { value: "diagnostics", label: "Diagnostics" },
] as const;

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180] as const;

const RECURRENCE_OPTIONS = [
  { value: "", label: "Does not repeat" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
] as const;

function snapDuration(mins: number): number {
  const allowed: number[] = [...DURATION_OPTIONS];
  if (allowed.includes(mins)) return mins;
  return allowed.reduce((best, d) => (Math.abs(d - mins) < Math.abs(best - mins) ? d : best));
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStart: Date;
  initialDurationMins: number;
  clients: AppointmentFormClientOption[];
  /** Active booking types from Workspace (empty if none configured). */
  typeOptions: { code: string; label: string }[];
  /** Opens the full-page editor (Google “More options”). */
  onRequestFullEditor?: () => void;
  /** When opening from a call log, pre-fill client / vehicle / title / notes. */
  prefillFromCall?: BookingFromCallPayload | null;
  productServiceOptions?: ProductServiceOptionForBooking[] | null;
};

export function AppointmentQuickCreateDialog({
  open,
  onOpenChange,
  initialStart,
  initialDurationMins,
  clients,
  typeOptions,
  onRequestFullEditor,
  prefillFromCall = null,
  productServiceOptions = [],
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientDisplayName, setClientDisplayName] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [vehicleText, setVehicleText] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>(() => typeOptions[0]?.code ?? "");
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocalValue(initialStart));
  const [durationMins, setDurationMins] = useState(() => snapDuration(initialDurationMins));
  const [resourceKey, setResourceKey] = useState("front-desk");
  const [notes, setNotes] = useState("");
  const [entryKind, setEntryKind] = useState<CalendarEntryKind>("APPOINTMENT_SCHEDULE");
  const [location, setLocation] = useState("");
  const [guestEmails, setGuestEmails] = useState("");
  const [recurrenceRule, setRecurrenceRule] = useState("");
  const [showAs, setShowAs] = useState<"busy" | "free">("busy");
  const [visibility, setVisibility] = useState<
    "default" | "public" | "private" | "confidential"
  >("default");
  const [quoteLines, setQuoteLines] = useState<BookingQuoteLine[]>([{ product: "", priceText: "" }]);

  const vehicles = useMemo(() => {
    const c = clients.find((x) => x.id === clientId);
    return c?.vehicles ?? [];
  }, [clients, clientId]);

  useEffect(() => {
    if (!open) return;
    setStartLocal(toDatetimeLocalValue(initialStart));
    setDurationMins(snapDuration(initialDurationMins));
    setEntryKind("APPOINTMENT_SCHEDULE");
    setLocation("");
    setGuestEmails("");
    setRecurrenceRule("");
    setShowAs("busy");
    setVisibility("default");
    setError(null);
    setQuoteLines([{ product: "", priceText: "" }]);

    if (prefillFromCall) {
      const cid = prefillFromCall.clientId.trim();
      setClientId(cid);
      setClientPhone(prefillFromCall.clientPhone);
      setClientDisplayName(prefillFromCall.clientDisplayName);
      setVehicleText(prefillFromCall.vehicleText);
      setVehicleId("");
      const t = prefillFromCall.title.trim();
      setTitle(
        t.length >= 4 ? t : t.length > 0 ? `${t} — service visit` : "Service visit",
      );
      setNotes(prefillFromCall.notes);
    } else {
      setClientId("");
      setClientPhone("");
      setClientDisplayName("");
      setVehicleId("");
      setVehicleText("");
      setTitle("");
      setNotes("");
    }
  }, [open, initialStart, initialDurationMins, prefillFromCall]);

  useEffect(() => {
    if (!open || !prefillFromCall) return;
    const cid = prefillFromCall.clientId.trim();
    if (!cid) return;
    setVehicleId(matchVehicleIdForPrefill(clients, cid, prefillFromCall.vehicleText));
  }, [open, prefillFromCall, clients]);

  const selectEntryKind = (k: CalendarEntryKind) => {
    setEntryKind(k);
    if (k === "TASK") setShowAs("free");
    if (k === "EVENT" || k === "APPOINTMENT_SCHEDULE") setShowAs("busy");
  };

  useEffect(() => {
    if (!open || typeOptions.length === 0) return;
    setType((current) =>
      typeOptions.some((o) => o.code === current) ? current : typeOptions[0]!.code,
    );
  }, [open, typeOptions]);

  if (!open) return null;

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
      setError("Choose a booking type. Add one under Workspace → Booking types if the list is empty.");
      return;
    }
    if (!validateBookingQuoteLinesBeforeSubmit()) {
      return;
    }
    const fd = new FormData();
    if (clientId) {
      fd.set("clientId", clientId);
    } else {
      fd.set("newClientDisplayName", clientDisplayName.trim());
      fd.set("newClientPhone", clientPhone.trim());
    }
    fd.set("vehicleId", vehicleId);
    fd.set("newVehicleLabel", vehicleText.trim());
    fd.set("title", title.trim());
    fd.set("type", type);
    fd.set("startAt", new Date(startLocal).toISOString());
    fd.set("durationMins", String(durationMins));
    fd.set("resourceKey", resourceKey);
    fd.set("notes", notes);
    fd.set("calendarEntryKind", entryKind);
    fd.set("location", location);
    fd.set("guestEmails", guestEmails);
    fd.set("recurrenceRule", recurrenceRule);
    fd.set("showAs", showAs);
    fd.set("visibility", visibility);
    fd.set("allDay", "false");
    if (prefillFromCall?.callLogId?.trim()) {
      fd.set("callLogId", prefillFromCall.callLogId.trim());
    } else {
      fd.set("productQuoteLinesJson", serializeBookingQuoteLines(quoteLines));
    }
    startTransition(async () => {
      try {
        await createAppointmentAction(fd);
        router.refresh();
        onOpenChange(false);
        setTitle("");
        setNotes("");
        setVehicleId("");
        setVehicleText("");
        setClientId("");
        setClientPhone("");
        setClientDisplayName("");
        setLocation("");
        setGuestEmails("");
        setRecurrenceRule("");
        setEntryKind("APPOINTMENT_SCHEDULE");
        setShowAs("busy");
        setVisibility("default");
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save booking.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 flex max-h-[min(94dvh,900px)] w-full max-w-[min(56rem,calc(100vw-1.5rem))] flex-col rounded-t-[20px] border border-[#dadce0] bg-white shadow-2xl sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between border-b border-[#dadce0] px-5 py-2.5">
          <h2 className="text-lg font-medium text-[#3c4043]">Add to calendar</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-full p-2 text-[#5f6368] hover:bg-[#f1f3f4]"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
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
                onClick={() => selectEntryKind(k)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold transition",
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
            <div className="mb-2 rounded-lg border border-[#dadce0] bg-[#f8f9fa] px-2.5 py-1.5 text-[11px] leading-snug text-[#5f6368]">
              Schedule-style booking in CRM; types/colors follow{" "}
              <strong className="text-[#3c4043]">Workspace → Booking types</strong>.
            </div>
          ) : null}

          <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Add title"
                  className="mt-0.5 w-full rounded-lg border border-[#dadce0] px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                />
              </label>

              <BookingClientPickFields
                compact
                clients={clients}
                clientId={clientId}
                onClientIdChange={(id) => {
                  setClientId(id);
                  setVehicleId("");
                  setVehicleText("");
                }}
                phone={clientPhone}
                onPhoneChange={setClientPhone}
                displayName={clientDisplayName}
                onDisplayNameChange={setClientDisplayName}
              />
              <BookingVehiclePickField
                compact
                vehicles={clientId ? vehicles : []}
                vehicleId={vehicleId}
                vehicleText={vehicleText}
                onVehicleIdChange={setVehicleId}
                onVehicleTextChange={setVehicleText}
              />
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Type</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  disabled={typeOptions.length === 0}
                  className="mt-0.5 w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8] disabled:bg-[#f1f3f4] disabled:text-[#70757a]"
                >
                  {typeOptions.length === 0 ? (
                    <option value="">No types — open Workspace → Booking types</option>
                  ) : (
                    typeOptions.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Starts</span>
                  <input
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    className="mt-0.5 w-full min-w-0 rounded-lg border border-[#dadce0] px-2 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  />
                </label>
                <label className="block min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Duration</span>
                  <select
                    value={durationMins}
                    onChange={(e) => setDurationMins(Number(e.target.value))}
                    className="mt-0.5 w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  >
                    {DURATION_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m} minutes
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Recurrence</span>
                  <select
                    value={recurrenceRule}
                    onChange={(e) => setRecurrenceRule(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  >
                    {RECURRENCE_OPTIONS.map((o) => (
                      <option key={o.value || "x"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Resource</span>
                  <select
                    value={resourceKey}
                    onChange={(e) => setResourceKey(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  >
                    {RESOURCE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Location</span>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Add location"
                  className="mt-0.5 w-full rounded-lg border border-[#dadce0] px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Guests (emails)</span>
                <textarea
                  value={guestEmails}
                  onChange={(e) => setGuestEmails(e.target.value)}
                  placeholder="Comma separated"
                  rows={1}
                  className="mt-0.5 min-h-[2.25rem] w-full resize-y rounded-lg border border-[#dadce0] px-3 py-2 text-sm leading-snug outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Show as</span>
                  <select
                    value={showAs}
                    onChange={(e) => setShowAs(e.target.value as "busy" | "free")}
                    className="mt-0.5 w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  >
                    <option value="busy">Busy</option>
                    <option value="free">Free</option>
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Visibility</span>
                  <select
                    value={visibility}
                    onChange={(e) =>
                      setVisibility(
                        e.target.value as "default" | "public" | "private" | "confidential",
                      )
                    }
                    className="mt-0.5 w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                  >
                    <option value="default">Default</option>
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                    <option value="confidential">Confidential</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:col-span-2">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Notes (optional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={1}
                  className="mt-0.5 min-h-[2.25rem] w-full resize-y rounded-lg border border-[#dadce0] px-3 py-2 text-sm leading-snug outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
                />
              </label>
              <BookingProductQuoteLines
                compact
                productOptions={productServiceOptions}
                lines={quoteLines}
                onLinesChange={setQuoteLines}
                disabled={Boolean(prefillFromCall?.callLogId?.trim())}
              />
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#dadce0] px-5 py-2.5">
          {onRequestFullEditor ? (
            <button
              type="button"
              onClick={() => {
                onRequestFullEditor();
              }}
              className="text-sm font-medium text-[#1a73e8] hover:underline"
            >
              More options
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className={cn(
              "rounded-lg bg-[#1a73e8] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1765cc]",
              pending && "opacity-60",
            )}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
