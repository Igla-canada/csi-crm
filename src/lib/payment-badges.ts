import type { PaymentEventView } from "@/lib/crm-types";

function badgeLabelForKindSet(kinds: Set<string>): string | null {
  if (kinds.size === 0) return null;
  if (kinds.size === 1) {
    const k = [...kinds][0]!;
    if (k === "DEPOSIT") return "Deposit logged";
    if (k === "PAYMENT") return "Payment logged";
    if (k === "REFUND") return "Refund logged";
  }
  return "Payments on file";
}

function badgeLabelForEvents(sub: PaymentEventView[]): string | null {
  if (!sub.length) return null;
  return badgeLabelForKindSet(new Set(sub.map((e) => e.kind)));
}

/** For server queries that only select `kind` (e.g. Tasks queue). */
export function paymentBadgeLabelForKindsList(kinds: string[]): string | null {
  return badgeLabelForKindSet(new Set(kinds));
}

export function paymentBadgeLabelForAppointment(
  appointmentId: string,
  events: PaymentEventView[],
): string | null {
  return badgeLabelForEvents(events.filter((e) => e.appointmentId === appointmentId));
}

/** Includes events tied to this call or to a booking linked from this call. */
export function paymentBadgeLabelForCall(
  callId: string,
  linkedAppointmentId: string | null,
  events: PaymentEventView[],
): string | null {
  const sub = events.filter(
    (e) =>
      e.callLogId === callId ||
      (linkedAppointmentId != null && e.appointmentId === linkedAppointmentId),
  );
  return badgeLabelForEvents(sub);
}
