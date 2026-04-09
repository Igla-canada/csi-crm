/** Session key for “open Bookings with call context” (set before navigating to /appointments). */
export const BOOKING_FROM_CALL_STORAGE_KEY = "csicrm.bookingFromCall.v1";

/** Built-in call result code for “booked” — label in Settings may differ (e.g. “Book”). */
export const CALL_OUTCOME_BOOKED_CODE = "BOOKED";

export type BookingFromCallPayload = {
  clientId: string;
  clientPhone: string;
  clientDisplayName: string;
  vehicleText: string;
  title: string;
  notes: string;
  /** When present, the new booking is stored with this call log id (CRM traceability). */
  callLogId?: string | null;
};

export function buildBookingTitleFromCall(vehicleText: string, product: string): string {
  const v = vehicleText.trim();
  const prod = product.trim();
  if (v && prod) return `${v} — ${prod}`;
  if (v) return v;
  if (prod) return prod;
  return "Service booking";
}

/** Title when a call has multiple product lines (uses labels shown in Log a Call). */
export function buildBookingTitleFromCallLines(vehicleText: string, productLabels: string[]): string {
  const v = vehicleText.trim();
  const parts = productLabels.map((p) => p.trim()).filter(Boolean);
  let prod = "";
  if (parts.length === 1) prod = parts[0]!;
  else if (parts.length === 2) prod = `${parts[0]} + ${parts[1]}`;
  else if (parts.length > 2) prod = `${parts[0]} + ${parts[1]} +${parts.length - 2} more`;
  return buildBookingTitleFromCall(v, prod);
}

export function buildBookingNotesFromCall(parts: {
  priceDigits: string;
  priceDisplay: string | null;
  summary: string;
  callbackNotes: string;
}): string {
  const lines: string[] = [];
  const priceRaw = parts.priceDigits.trim();
  if (priceRaw) {
    lines.push(/^\d+$/.test(priceRaw) ? `Quote: $${priceRaw}` : `Quote: ${priceRaw}`);
  } else if (parts.priceDisplay?.trim()) {
    lines.push(`Quote: ${parts.priceDisplay.trim()}`);
  }
  if (parts.summary.trim()) lines.push(parts.summary.trim());
  if (parts.callbackNotes.trim()) lines.push(`Callback: ${parts.callbackNotes.trim()}`);
  return lines.join("\n\n").slice(0, 8000);
}

export function buildBookingNotesFromCallLines(parts: {
  linePrices: string[];
  summary: string;
  callbackNotes: string;
}): string {
  const quoteBits = parts.linePrices.map((p) => p.trim()).filter(Boolean);
  const lines: string[] = [];
  if (quoteBits.length) {
    const formatted = quoteBits.map((priceRaw) =>
      /^\d+$/.test(priceRaw) ? `$${priceRaw}` : priceRaw,
    );
    lines.push(
      quoteBits.length > 1 ? `Quotes: ${formatted.join(" · ")}` : `Quote: ${formatted[0]}`,
    );
  }
  if (parts.summary.trim()) lines.push(parts.summary.trim());
  if (parts.callbackNotes.trim()) lines.push(`Callback: ${parts.callbackNotes.trim()}`);
  return lines.join("\n\n").slice(0, 8000);
}

export function writeBookingFromCallToSession(p: BookingFromCallPayload): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(BOOKING_FROM_CALL_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota / private mode */
  }
}

export function peekBookingFromCall(): BookingFromCallPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(BOOKING_FROM_CALL_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<BookingFromCallPayload>;
    if (!p || typeof p !== "object") return null;
    const callLogId =
      typeof p.callLogId === "string" && p.callLogId.trim() ? p.callLogId.trim() : null;
    return {
      clientId: String(p.clientId ?? ""),
      clientPhone: String(p.clientPhone ?? ""),
      clientDisplayName: String(p.clientDisplayName ?? ""),
      vehicleText: String(p.vehicleText ?? ""),
      title: String(p.title ?? ""),
      notes: String(p.notes ?? ""),
      callLogId,
    };
  } catch {
    return null;
  }
}

export function readAndClearBookingFromCall(): BookingFromCallPayload | null {
  const p = peekBookingFromCall();
  if (p) {
    try {
      sessionStorage.removeItem(BOOKING_FROM_CALL_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return p;
}

/** Next reasonable slot start when coming from a call log (not a calendar click). */
export function defaultNextBookingStart(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setSeconds(0, 0);
  let mins = d.getMinutes();
  mins = Math.ceil(mins / 15) * 15;
  d.setMinutes(mins);
  if (d.getMinutes() >= 60) {
    d.setHours(d.getHours() + 1);
    d.setMinutes(0);
  }
  const h = d.getHours();
  if (h < 7) {
    d.setHours(9, 0, 0, 0);
  } else if (h >= 18) {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }
  return d;
}
