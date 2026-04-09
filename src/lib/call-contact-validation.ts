import { UserInputError } from "@/lib/user-input-error";

/** Rules for Log a Call / call log edit: phone digits and customer name. */

export const CALL_LOG_PHONE_DIGITS = 10;

export function normalizeCallLogPhoneDigits(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, CALL_LOG_PHONE_DIGITS);
}

/** Empty is allowed; otherwise must be exactly {@link CALL_LOG_PHONE_DIGITS} digits. */
export function assertCallLogPhoneValid(digits: string): void {
  if (!digits) return;
  if (digits.length !== CALL_LOG_PHONE_DIGITS) {
    throw new UserInputError(
      `Phone must be exactly ${CALL_LOG_PHONE_DIGITS} digits, or leave it blank when there is no number for this call.`,
    );
  }
}

const CONTACT_NAME_RE = /^[\p{L}\s'-]+$/u;

export function assertContactNameValid(name: string): void {
  const t = name.trim();
  if (!t) {
    throw new UserInputError("Please enter the customer name.");
  }
  if (!CONTACT_NAME_RE.test(t)) {
    throw new UserInputError(
      "Customer name can only include letters, spaces, apostrophes, and hyphens (no numbers).",
    );
  }
}
