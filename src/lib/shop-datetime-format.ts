import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** Format an instant in a specific IANA timezone (e.g. America/Toronto). */
export function formatShopDateTime(instant: Date, timeZone: string): string {
  const z = new TZDate(instant.getTime(), timeZone);
  return format(z, "MMM d, yyyy · h:mm a");
}

export function formatShopDateShort(instant: Date, timeZone: string): string {
  const z = new TZDate(instant.getTime(), timeZone);
  return format(z, "MMM d, yyyy");
}
