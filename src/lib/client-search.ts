import type { ClientListRow } from "@/lib/crm";
import { normalizePhone } from "@/lib/phone";

function companyNameOf(client: ClientListRow): string {
  return client.companyName?.trim() ? String(client.companyName) : "";
}

/**
 * Match clients by free text (name, company, notes, emails, phones as stored, vehicles, products)
 * or by normalized phone digits (e.g. "416-555-0100" matches stored formats).
 */
export function clientMatchesSearchQuery(client: ClientListRow, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    client.displayName,
    companyNameOf(client),
    client.source,
    client.notes,
    ...client.contactPoints.map((point) => point.value),
    ...client.vehicles.map((vehicle) => vehicle.label),
    ...client.opportunities.map((opportunity) => opportunity.productDisplay ?? opportunity.product),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (haystack.includes(q)) return true;

  const digits = rawQuery.replace(/\D/g, "");
  if (digits.length >= 3) {
    for (const p of client.contactPoints) {
      const nv = normalizePhone(p.value);
      if (nv && nv.includes(digits)) return true;
    }
  }

  return false;
}

export function filterClientsBySearchQuery(rows: ClientListRow[], rawQuery: string): ClientListRow[] {
  const q = rawQuery.trim();
  if (!q) return rows;
  return rows.filter((c) => clientMatchesSearchQuery(c, rawQuery));
}
