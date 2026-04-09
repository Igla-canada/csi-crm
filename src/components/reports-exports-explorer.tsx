"use client";

import {
  endOfMonth,
  endOfWeek,
  format,
  formatISO,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { deletePaymentEventAction, updatePaymentEventAction } from "@/app/actions";
import { PAYMENT_EVENT_KINDS, PAYMENT_EVENT_METHODS } from "@/lib/crm-types";
import { cn } from "@/lib/crm-shared";

type ExplorerMode = "payments" | "bookings";
type Preset = "all" | "day" | "week" | "month" | "custom";

type PaymentApiRow = {
  id: string;
  clientId: string;
  clientName: string;
  receivedAt: string;
  kind: string;
  amountCents: number;
  signedAmountCents: number;
  method: string;
  reference: string | null;
  notes: string | null;
  appointmentId: string | null;
  callLogId: string | null;
  linkedBookingTitle: string | null;
  linkedBookingStartAt: string | null;
  recordedByName: string;
};

type BookingApiRow = {
  appointmentId: string;
  clientId: string;
  clientName: string;
  title: string;
  startAtIso: string;
  callLogId: string | null;
  callHappenedAtIso: string | null;
  callSummary: string | null;
  linked: boolean;
};

function formatMoney(cents: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const field =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-[#1e5ea8] focus:ring-2 focus:ring-[#1e5ea8]/20";

type Props = {
  /** Which dataset to load — set from the parent Reports tab (`deposits` → payments, `bookings` → bookings). */
  mode: ExplorerMode;
  canEditPayments: boolean;
  className?: string;
};

export function ReportsExportsExplorer({ mode, canEditPayments, className }: Props) {
  const tab = mode;
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState(() => formatISO(startOfMonth(new Date()), { representation: "date" }));
  const [customTo, setCustomTo] = useState(() => formatISO(endOfMonth(new Date()), { representation: "date" }));
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [paymentRows, setPaymentRows] = useState<PaymentApiRow[]>([]);
  const [bookingRows, setBookingRows] = useState<BookingApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PaymentApiRow | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editKind, setEditKind] = useState<(typeof PAYMENT_EVENT_KINDS)[number]>("DEPOSIT");
  const [editMethod, setEditMethod] = useState<(typeof PAYMENT_EVENT_METHODS)[number]>("CARD");
  const [editReceivedAt, setEditReceivedAt] = useState("");
  const [editReference, setEditReference] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 320);
    return () => clearTimeout(t);
  }, [search]);

  const { fromStr, toStr } = useMemo(() => {
    const now = new Date();
    if (preset === "all") return { fromStr: "", toStr: "" };
    if (preset === "day") {
      const d = formatISO(startOfDay(now), { representation: "date" });
      return { fromStr: d, toStr: d };
    }
    if (preset === "week") {
      return {
        fromStr: formatISO(startOfWeek(now, { weekStartsOn: 1 }), { representation: "date" }),
        toStr: formatISO(endOfWeek(now, { weekStartsOn: 1 }), { representation: "date" }),
      };
    }
    if (preset === "month") {
      return {
        fromStr: formatISO(startOfMonth(now), { representation: "date" }),
        toStr: formatISO(endOfMonth(now), { representation: "date" }),
      };
    }
    return { fromStr: customFrom, toStr: customTo };
  }, [preset, customFrom, customTo]);

  const csvHref = useMemo(() => {
    const q = fromStr && toStr ? `?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}` : "";
    if (tab === "payments") return `/api/reports/payments-csv${q}`;
    return `/api/reports/booking-call-links-csv${q}`;
  }, [tab, fromStr, toStr]);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      params.set("type", tab);
      if (fromStr && toStr) {
        params.set("from", fromStr);
        params.set("to", toStr);
      }
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      const res = await fetch(`/api/reports/explorer?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { type: string; rows: unknown[] };
      if (data.type === "payments") {
        setPaymentRows(data.rows as PaymentApiRow[]);
      } else {
        setBookingRows(data.rows as BookingApiRow[]);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Could not load data.");
    } finally {
      setLoading(false);
    }
  }, [tab, fromStr, toStr, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (r: PaymentApiRow) => {
    setEditing(r);
    setEditAmount((r.amountCents / 100).toFixed(2));
    setEditKind(r.kind as (typeof PAYMENT_EVENT_KINDS)[number]);
    setEditMethod(r.method as (typeof PAYMENT_EVENT_METHODS)[number]);
    setEditReceivedAt(toDatetimeLocalValue(r.receivedAt));
    setEditReference(r.reference ?? "");
    setEditNotes(r.notes ?? "");
    setEditError(null);
  };

  const kindLabel = (k: string) =>
    k === "DEPOSIT" ? "Deposit" : k === "PAYMENT" ? "Payment" : "Refund";
  const methodLabel = (m: string) =>
    m === "ETRANSFER" ? "E-transfer" : m.charAt(0) + m.slice(1).toLowerCase();

  const saveEdit = () => {
    if (!editing) return;
    setEditError(null);
    const fd = new FormData();
    fd.set("paymentEventId", editing.id);
    fd.set("clientId", editing.clientId);
    fd.set("appointmentId", editing.appointmentId ?? "");
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
        await load();
      } catch (e) {
        setEditError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  };

  const removePayment = (r: PaymentApiRow) => {
    if (!confirm(`Remove this ${kindLabel(r.kind).toLowerCase()} of ${formatMoney(r.amountCents)} for ${r.clientName}?`)) {
      return;
    }
    const fd = new FormData();
    fd.set("paymentEventId", r.id);
    startTransition(async () => {
      try {
        await deletePaymentEventAction(fd);
        if (editing?.id === r.id) setEditing(null);
        await load();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Could not remove entry.");
      }
    });
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <span className="w-full text-[0.65rem] font-bold uppercase tracking-[0.14em] text-slate-400 lg:w-auto lg:mr-1">
            Date range
          </span>
          {(["all", "day", "week", "month", "custom"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition",
                preset === p
                  ? "border-[#1e5ea8] bg-[#e8f1fb] text-[#17497f]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              {p === "all" ? "All time" : p}
            </button>
          ))}
        </div>

        {preset === "custom" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-slate-600">
              <span className="mb-1 block">From</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className={field}
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              <span className="mb-1 block">To</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={field} />
            </label>
          </div>
        ) : null}

        <div className="min-w-[min(100%,18rem)] flex-1 lg:max-w-md">
          <label className="text-xs font-medium text-slate-600">
            <span className="mb-1 block">
              {tab === "payments"
                ? "Search (notes, client, booking title, reference, IDs, staff…)"
                : "Search (call summary, client, booking title, IDs, dates…)"}
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "payments" ? "e.g. etransfer remote starter" : "e.g. callback deposit IGLA"}
              className={field}
            />
          </label>
        </div>

        <a
          href={csvHref}
          className="inline-flex items-center justify-center rounded-lg border border-[#1e5ea8] bg-white px-4 py-2 text-sm font-semibold text-[#1e5ea8] shadow-sm transition hover:bg-[#f2f7fd]"
        >
          Download CSV (same range)
        </a>
      </div>

      <p className="text-xs text-slate-500">
        {tab === "payments"
          ? "Each word you type must appear somewhere in the row (e.g. purpose notes, client, linked booking, reference). Use fragments from the conversation or memo."
          : "Each word must match the booking row or its linked call summary — handy when you only remember part of what was said on the call."}
      </p>

      {fetchError ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{fetchError}</p>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
      ) : tab === "payments" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200/90">
          <table className="min-w-[720px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5">Received</th>
                <th className="px-3 py-2.5">Client</th>
                <th className="px-3 py-2.5">Amount</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5 min-w-[140px]">Purpose / notes</th>
                <th className="px-3 py-2.5 min-w-[120px]">Booking</th>
                <th className="px-3 py-2.5">Logged by</th>
                {canEditPayments ? <th className="px-3 py-2.5 w-28">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {paymentRows.length === 0 ? (
                <tr>
                  <td colSpan={canEditPayments ? 8 : 7} className="px-3 py-8 text-center text-slate-500">
                    No payment events in this range{debouncedSearch.trim() ? " matching your search" : ""}.
                  </td>
                </tr>
              ) : (
                paymentRows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 align-top text-slate-700 whitespace-nowrap">
                      {format(parseISO(r.receivedAt), "MMM d, yyyy · h:mm a")}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Link
                        href={`/clients/${r.clientId}?tab=payments`}
                        className="font-medium text-[#1e5ea8] hover:underline"
                      >
                        {r.clientName || "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 align-top font-semibold tabular-nums">{formatMoney(r.amountCents)}</td>
                    <td className="px-3 py-2.5 align-top text-slate-600">
                      {kindLabel(r.kind)} · {methodLabel(r.method)}
                      {r.reference ? (
                        <span className="mt-0.5 block text-xs text-slate-500">Ref: {r.reference}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 align-top text-slate-700">
                      {r.notes?.trim() ? (
                        <span className="line-clamp-4 whitespace-pre-wrap">{r.notes}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-slate-700">
                      {r.appointmentId && r.linkedBookingTitle ? (
                        <Link
                          href={`/appointments/${r.appointmentId}/edit`}
                          className="text-[#1e5ea8] hover:underline line-clamp-3"
                          title={r.linkedBookingTitle}
                        >
                          {r.linkedBookingTitle}
                          {r.linkedBookingStartAt ? (
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {format(parseISO(r.linkedBookingStartAt), "MMM d, yyyy")}
                            </span>
                          ) : null}
                        </Link>
                      ) : r.appointmentId ? (
                        <Link href={`/appointments/${r.appointmentId}/edit`} className="text-xs text-[#1e5ea8] hover:underline">
                          Open booking
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-slate-600">{r.recordedByName}</td>
                    {canEditPayments ? (
                      <td className="px-3 py-2.5 align-top whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="mr-2 text-xs font-semibold text-[#1e5ea8] hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => removePayment(r)}
                          disabled={pending}
                          className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/90">
          <table className="min-w-[800px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5">Booking start</th>
                <th className="px-3 py-2.5">Client</th>
                <th className="px-3 py-2.5">Title</th>
                <th className="px-3 py-2.5 min-w-[200px]">Call log summary</th>
                <th className="px-3 py-2.5">Booked</th>
              </tr>
            </thead>
            <tbody>
              {bookingRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    No bookings in this range{debouncedSearch.trim() ? " matching your search" : ""}.
                  </td>
                </tr>
              ) : (
                bookingRows.map((r) => (
                  <tr key={r.appointmentId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 align-top whitespace-nowrap text-slate-700">
                      {format(parseISO(r.startAtIso), "MMM d, yyyy · h:mm a")}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Link
                        href={`/clients/${r.clientId}`}
                        className="font-medium text-[#1e5ea8] hover:underline"
                      >
                        {r.clientName || "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Link
                        href={`/appointments/${r.appointmentId}/edit`}
                        className="text-[#1e5ea8] hover:underline line-clamp-2"
                      >
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 align-top text-slate-700">
                      {r.callSummary?.trim() ? (
                        <p className="line-clamp-4 whitespace-pre-wrap text-sm">{r.callSummary}</p>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {r.linked ? (
                        <Link
                          href={`/appointments/${r.appointmentId}/edit`}
                          className="group inline-flex max-w-full flex-col gap-1 rounded-lg p-1 -m-1 outline-none transition hover:bg-emerald-50/90 focus-visible:ring-2 focus-visible:ring-[#1e5ea8] focus-visible:ring-offset-2"
                        >
                          <span className="inline-flex w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                            Yes
                          </span>
                          <span className="text-xs font-semibold text-[#1e5ea8] underline-offset-2 group-hover:underline">
                            Open booking
                          </span>
                          {r.callLogId ? (
                            <span className="break-all font-mono text-[0.65rem] text-slate-400" title="Call log id">
                              {r.callLogId}
                            </span>
                          ) : null}
                        </Link>
                      ) : (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          No
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-payment-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-200">
            <h3 id="edit-payment-title" className="text-lg font-semibold text-slate-900">
              Edit payment
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {editing.clientName} — booking and call links stay as recorded unless you change them on the client profile.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-slate-500">Amount</span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                  <input
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className={cn(field, "pl-7")}
                    inputMode="decimal"
                  />
                </div>
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-500">Type</span>
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
                <span className="mb-1 block text-xs font-medium text-slate-500">Method</span>
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
                <span className="mb-1 block text-xs font-medium text-slate-500">Received</span>
                <input
                  type="datetime-local"
                  value={editReceivedAt}
                  onChange={(e) => setEditReceivedAt(e.target.value)}
                  className={field}
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-slate-500">Reference</span>
                <input value={editReference} onChange={(e) => setEditReference(e.target.value)} className={field} />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-slate-500">Purpose / notes</span>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  className={cn(field, "resize-y")}
                />
              </label>
            </div>
            {editError ? <p className="mt-3 text-sm text-red-700">{editError}</p> : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveEdit}
                disabled={pending}
                className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={pending}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
