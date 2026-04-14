/** Types shared between server CRM logic and client forms (no server-only deps). */

export type ClientPhoneMatch = {
  id: string;
  displayName: string;
};

export const CALENDAR_ENTRY_KINDS = ["EVENT", "TASK", "APPOINTMENT_SCHEDULE"] as const;
export type CalendarEntryKind = (typeof CALENDAR_ENTRY_KINDS)[number];

export type AppointmentFormClientOption = {
  id: string;
  displayName: string;
  phones: Array<{ value: string; normalized: string }>;
  vehicles: Array<{ id: string; label: string }>;
};

export type AppointmentEditorModel = {
  id: string;
  clientId: string;
  vehicleId: string | null;
  /** Display label for the linked vehicle (empty if none). */
  vehicleLabel: string;
  title: string;
  type: string;
  startAt: Date;
  endAt: Date;
  resourceKey: string;
  notes: string | null;
  googleEventId: string | null;
  calendarEntryKind: string;
  location: string | null;
  guestEmails: string | null;
  allDay: boolean;
  recurrenceRule: string | null;
  showAs: string;
  visibility: string;
  /** Digits-only deposit amount (CRM-only), same style as call quotes. */
  depositText: string | null;
  /** When set, this booking was created from that call log (traceability). */
  callLogId: string | null;
  /** Optional tag for CRM + Google Calendar color (`CalendarTagOption`). */
  calendarTagCode: string | null;
  /** Snapshot of the linked call when `callLogId` is set. */
  linkedCall: { id: string; happenedAt: Date; summary: string } | null;
  client: { id: string; displayName: string };
};

export const PAYMENT_EVENT_KINDS = ["DEPOSIT", "PAYMENT", "REFUND"] as const;
export const PAYMENT_EVENT_METHODS = ["CASH", "CARD", "CHECK", "ETRANSFER", "OTHER"] as const;

export type PaymentEventView = {
  id: string;
  clientId: string;
  appointmentId: string | null;
  callLogId: string | null;
  kind: (typeof PAYMENT_EVENT_KINDS)[number];
  amountCents: number;
  receivedAt: Date;
  method: (typeof PAYMENT_EVENT_METHODS)[number];
  reference: string | null;
  notes: string | null;
  recordedById: string;
  recordedByName: string;
  /** Present when `appointmentId` is set and the booking row was loaded (same client on list queries). */
  linkedBooking: { id: string; title: string; startAt: Date } | null;
};

/** Positive inflow; REFUND amounts are stored as positive cents and subtracted in totals via kind. */
export function signedPaymentAmountCents(kind: string, amountCents: number): number {
  return kind === "REFUND" ? -amountCents : amountCents;
}
