"use client";

import { format } from "date-fns";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createPaymentEventAction, deletePaymentEventAction, updatePaymentEventAction } from "@/app/actions";
import {
  PAYMENT_EVENT_KINDS,
  PAYMENT_EVENT_METHODS,
  type PaymentEventView,
  signedPaymentAmountCents,
} from "@/lib/crm-types";
import { cn } from "@/lib/crm-shared";

function formatMoney(cents: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const field =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#1e5ea8] focus:ring-2 focus:ring-[#1e5ea8]/20";

type AppointmentChoice = { id: string; label: string };

type Props = {
  clientId: string;
  lockAppointmentId?: string;
  defaultCallLogId?: string | null;
  appointmentChoices?: AppointmentChoice[];
  initialEvents: PaymentEventView[];
  title?: string;
  className?: string;
  readOnly?: boolean;
};

export function PaymentEventsPanel({
  clientId,
  lockAppointmentId,
  defaultCallLogId = null,
  appointmentChoices = [],
  initialEvents,
  title = "Deposits & payments",
  className,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<(typeof PAYMENT_EVENT_KINDS)[number]>("DEPOSIT");
  const [method, setMethod] = useState<(typeof PAYMENT_EVENT_METHODS)[number]>("CARD");
  const [receivedAt, setReceivedAt] = useState(() => toDatetimeLocalValue(new Date()));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [pickedAppointment, setPickedAppointment] = useState("");
  /** On the client profile, keep the form tucked away — full accounting still lives in your books / exports. */
  const [formOpen, setFormOpen] = useState(() => Boolean(lockAppointmentId));

  const [editing, setEditing] = useState<PaymentEventView | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editKind, setEditKind] = useState<(typeof PAYMENT_EVENT_KINDS)[number]>("DEPOSIT");
  const [editMethod, setEditMethod] = useState<(typeof PAYMENT_EVENT_METHODS)[number]>("CARD");
  const [editReceivedAt, setEditReceivedAt] = useState("");
  const [editReference, setEditReference] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAppointmentId, setEditAppointmentId] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const totalSignedCents = useMemo(
    () => initialEvents.reduce((s, e) => s + signedPaymentAmountCents(e.kind, e.amountCents), 0),
    [initialEvents],
  );

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("clientId", clientId);
    if (lockAppointmentId) {
      fd.set("lockAppointmentId", lockAppointmentId);
    } else if (pickedAppointment.trim()) {
      fd.set("appointmentId", pickedAppointment.trim());
    }
    if (defaultCallLogId?.trim()) {
      fd.set("callLogId", defaultCallLogId.trim());
    }
    fd.set("amount", amount);
    fd.set("kind", kind);
    fd.set("method", method);
    fd.set("receivedAt", new Date(receivedAt).toISOString());
    if (reference.trim()) fd.set("reference", reference.trim());
    if (notes.trim()) fd.set("notes", notes.trim());

    startTransition(async () => {
      try {
        await createPaymentEventAction(fd);
        setAmount("");
        setReference("");
        setNotes("");
        setReceivedAt(toDatetimeLocalValue(new Date()));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save payment.");
      }
    });
  };

  const kindLabel = (k: string) =>
    k === "DEPOSIT" ? "Deposit" : k === "PAYMENT" ? "Payment" : "Refund";

  const methodLabel = (m: string) =>
    m === "ETRANSFER" ? "E-transfer" : m.charAt(0) + m.slice(1).toLowerCase();

  const openEdit = (ev: PaymentEventView) => {
    setEditing(ev);
    setEditAmount((ev.amountCents / 100).toFixed(2));
    setEditKind(ev.kind);
    setEditMethod(ev.method);
    setEditReceivedAt(toDatetimeLocalValue(ev.receivedAt));
    setEditReference(ev.reference ?? "");
    setEditNotes(ev.notes ?? "");
    setEditAppointmentId(ev.appointmentId ?? "");
    setEditError(null);
  };

  const saveEdit = () => {
    if (!editing) return;
    setEditError(null);
    const fd = new FormData();
    fd.set("paymentEventId", editing.id);
    fd.set("clientId", clientId);
    const aptForSave = lockAppointmentId
      ? lockAppointmentId
      : appointmentChoices.length
        ? editAppointmentId.trim()
        : (editing.appointmentId ?? "");
    fd.set("appointmentId", aptForSave);
    fd.set("callLogId", editing.callLogId ?? "");
    fd.set("amount", editAmount);
    fd.set("kind", editKind);
    fd.set("method", editMethod);
    fd.set("receivedAt", new Date(editReceivedAt).toISOString());
    if (editReference.trim()) fd.set("reference", editReference.trim());
    if (editNotes.trim()) fd.set("notes", editNotes.trim());

    startTransition(async () => {
      try {
        await updatePaymentEventAction(fd);
        setEditing(null);
        router.refresh();
      } catch (e) {
        setEditError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  };

  const removeEvent = (ev: PaymentEventView) => {
    if (
      !confirm(
        `Remove this ${kindLabel(ev.kind).toLowerCase()} of ${formatMoney(ev.amountCents)}? This cannot be undone.`,
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("paymentEventId", ev.id);
    startTransition(async () => {
      try {
        await deletePaymentEventAction(fd);
        if (editing?.id === ev.id) setEditing(null);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Could not remove entry.");
      }
    });
  };

  return (
    <section
      className={cn(
        "crm-soft-panel rounded-[22px] p-5 shadow-[0_16px_48px_rgba(30,94,168,0.08)] ring-1 ring-slate-200/80 sm:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b border-slate-200/90 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-slate-400">Reconciliation helper</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Optional log for deposits and in-shop payments so you can tie activity to clients and exports. This is not a
            replacement for your accounting system — use{" "}
            <span className="font-medium text-slate-800">Reports → Deposits & payments</span> for CSV rollups.
          </p>
        </div>
        <div
          className={cn(
            "shrink-0 rounded-2xl border px-4 py-3 text-right tabular-nums shadow-sm",
            totalSignedCents >= 0
              ? "border-emerald-200/80 bg-emerald-50/90 text-emerald-950"
              : "border-amber-200/80 bg-amber-50/90 text-amber-950",
          )}
        >
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] opacity-80">Net (this view)</p>
          <p className="mt-0.5 text-lg font-bold">{formatMoney(totalSignedCents)}</p>
        </div>
      </div>

      {initialEvents.length ? (
        <ul className="mt-5 space-y-3">
          {initialEvents.map((ev) => (
            <li
              key={ev.id}
              className="crm-soft-row rounded-[18px] border border-slate-200/80 bg-white/80 px-4 py-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-base font-semibold text-slate-900">{formatMoney(ev.amountCents)}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                      {kindLabel(ev.kind)} · {methodLabel(ev.method)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {format(ev.receivedAt, "MMM d, yyyy · h:mm a")} · logged by {ev.recordedByName}
                  </p>
                  {ev.reference ? (
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="text-slate-400">Reference</span> {ev.reference}
                    </p>
                  ) : null}
                  {ev.notes ? (
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">
                      <span className="text-slate-400">Purpose / notes · </span>
                      {ev.notes}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">No description on file — use Edit to add what this was for.</p>
                  )}
                  {ev.linkedBooking && ev.appointmentId ? (
                    <p className="mt-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-500">Booking · </span>
                      <Link
                        href={`/appointments/${ev.appointmentId}/edit`}
                        className="font-medium text-[#1e5ea8] hover:underline"
                      >
                        {ev.linkedBooking.title}
                      </Link>
                      <span className="text-slate-500">
                        {" "}
                        · {format(ev.linkedBooking.startAt, "MMM d, yyyy")}
                      </span>
                    </p>
                  ) : ev.appointmentId ? (
                    <p className="mt-2 text-xs">
                      <Link
                        href={`/appointments/${ev.appointmentId}/edit`}
                        className="font-medium text-[#1e5ea8] hover:underline"
                      >
                        Linked booking
                      </Link>
                    </p>
                  ) : null}
                </div>
                {!readOnly ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(ev)}
                      className="text-xs font-semibold text-[#1e5ea8] hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => removeEvent(ev)}
                      disabled={pending}
                      className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-500">
          Nothing logged here yet. Entries you add show up for this client (and in reports when you export).
        </p>
      )}

      {readOnly ? null : (
        <div className="mt-5">
          {!formOpen ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#1e5ea8] shadow-sm transition hover:border-[#1e5ea8]/35 hover:bg-slate-50 sm:w-auto"
            >
              Add a deposit or payment
              <ChevronDown className="h-4 w-4 opacity-70" aria-hidden />
            </button>
          ) : (
            <div className="rounded-[18px] border border-slate-200/90 bg-gradient-to-b from-slate-50/80 to-white p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-slate-800">New entry</p>
                {!lockAppointmentId ? (
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    className="self-start text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                  >
                    Collapse
                  </button>
                ) : null}
              </div>

              <div className="grid gap-4 lg:grid-cols-12 lg:gap-x-4 lg:gap-y-4">
                <label className="lg:col-span-3">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Amount</span>
                  <div className="relative">
                    <span
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400"
                      aria-hidden
                    >
                      $
                    </span>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      className={cn(field, "pl-8")}
                    />
                  </div>
                </label>
                <label className="lg:col-span-3">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Type</span>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as (typeof PAYMENT_EVENT_KINDS)[number])}
                    className={field}
                  >
                    {PAYMENT_EVENT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {kindLabel(k)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lg:col-span-3">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Method</span>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as (typeof PAYMENT_EVENT_METHODS)[number])}
                    className={field}
                  >
                    {PAYMENT_EVENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {methodLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="lg:col-span-3">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Received</span>
                  <input
                    type="datetime-local"
                    value={receivedAt}
                    onChange={(e) => setReceivedAt(e.target.value)}
                    className={field}
                  />
                </label>

                {!lockAppointmentId && appointmentChoices.length ? (
                  <label className="lg:col-span-12">
                    <span className="mb-1.5 block text-xs font-medium text-slate-500">Link to booking (optional)</span>
                    <select
                      value={pickedAppointment}
                      onChange={(e) => setPickedAppointment(e.target.value)}
                      className={field}
                    >
                      <option value="">No booking</option>
                      {appointmentChoices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="lg:col-span-6">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Reference</span>
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Check #, bank memo…"
                    className={field}
                  />
                </label>
                <label className="lg:col-span-6">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Notes</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Optional context"
                    className={cn(field, "resize-y min-h-[4.5rem]")}
                  />
                </label>
              </div>

              {error ? (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{error}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={submit}
                  className={cn(
                    "rounded-xl bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900",
                    pending && "pointer-events-none opacity-60",
                  )}
                >
                  {pending ? "Saving…" : "Save entry"}
                </button>
                {!lockAppointmentId ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setFormOpen(false)}
                    className="text-sm font-medium text-slate-500 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {editing ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-payment-panel-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-200">
            <h3 id="edit-payment-panel-title" className="text-lg font-semibold text-slate-900">
              Edit entry
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {lockAppointmentId
                ? "This payment stays tied to the current booking."
                : "Change amount, type, or notes. Link or unlink a booking below."}
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Amount</span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <input
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    inputMode="decimal"
                    className={cn(field, "pl-8")}
                  />
                </div>
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Type</span>
                <select
                  value={editKind}
                  onChange={(e) => setEditKind(e.target.value as (typeof PAYMENT_EVENT_KINDS)[number])}
                  className={field}
                >
                  {PAYMENT_EVENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Method</span>
                <select
                  value={editMethod}
                  onChange={(e) => setEditMethod(e.target.value as (typeof PAYMENT_EVENT_METHODS)[number])}
                  className={field}
                >
                  {PAYMENT_EVENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {methodLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Received</span>
                <input
                  type="datetime-local"
                  value={editReceivedAt}
                  onChange={(e) => setEditReceivedAt(e.target.value)}
                  className={field}
                />
              </label>

              {!lockAppointmentId && appointmentChoices.length ? (
                <label className="sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Link to booking (optional)</span>
                  <select
                    value={editAppointmentId}
                    onChange={(e) => setEditAppointmentId(e.target.value)}
                    className={field}
                  >
                    <option value="">No booking</option>
                    {appointmentChoices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Reference</span>
                <input value={editReference} onChange={(e) => setEditReference(e.target.value)} className={field} />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Purpose / notes</span>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  placeholder="What this deposit or payment was for"
                  className={cn(field, "resize-y min-h-[5rem]")}
                />
              </label>
            </div>

            {editError ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{editError}</p>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveEdit}
                disabled={pending}
                className={cn(
                  "rounded-xl bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-900",
                  pending && "pointer-events-none opacity-60",
                )}
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={pending}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
