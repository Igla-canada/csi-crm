/**
 * Built-in lead sources (must stay aligned with `supabase/migrations/*_lead_source_option.sql` + seed).
 * Used when the `LeadSourceOption` table is missing so Log a Call and client pages still load before migrations run.
 */

export type LeadSourceBuiltinRow = {
  code: string;
  label: string;
  sortOrder: number;
  isBuiltIn: boolean;
  active: boolean;
  createdAt: string;
};

export const LEAD_SOURCE_BUILTIN_FALLBACK: LeadSourceBuiltinRow[] = [
  { code: "GOOGLE", label: "Google", sortOrder: 10, isBuiltIn: true, active: true, createdAt: "1970-01-01T00:00:00.000Z" },
  { code: "REFERRAL", label: "Referral", sortOrder: 20, isBuiltIn: true, active: true, createdAt: "1970-01-01T00:00:00.000Z" },
  { code: "WALK_IN", label: "Walk-in", sortOrder: 30, isBuiltIn: true, active: true, createdAt: "1970-01-01T00:00:00.000Z" },
  { code: "WEBSITE", label: "Website", sortOrder: 40, isBuiltIn: true, active: true, createdAt: "1970-01-01T00:00:00.000Z" },
  {
    code: "SOCIAL",
    label: "Social media",
    sortOrder: 50,
    isBuiltIn: true,
    active: true,
    createdAt: "1970-01-01T00:00:00.000Z",
  },
  {
    code: "BOOKING",
    label: "Booking / calendar",
    sortOrder: 55,
    isBuiltIn: true,
    active: true,
    createdAt: "1970-01-01T00:00:00.000Z",
  },
  { code: "OTHER", label: "Other", sortOrder: 60, isBuiltIn: true, active: true, createdAt: "1970-01-01T00:00:00.000Z" },
];

const builtinByCode = new Map(LEAD_SOURCE_BUILTIN_FALLBACK.map((r) => [r.code, r]));

export function leadSourceFallbackLabel(code: string): string | null {
  return builtinByCode.get(code)?.label ?? null;
}

export function isLeadSourceFallbackActiveCode(code: string): boolean {
  const r = builtinByCode.get(code);
  return Boolean(r?.active);
}

/** True when Postgres/PostgREST reports the lead-source table is missing or not in the API schema cache. */
export function isMissingLeadSourceRelationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; details?: string };
  const code = String(e.code ?? "");
  const msg = String(e.message ?? "").toLowerCase();
  const details = String(e.details ?? "").toLowerCase();
  if (code === "42P01" || code === "PGRST205") return true;
  if (msg.includes("leadsourceoption") && (msg.includes("does not exist") || msg.includes("schema cache"))) return true;
  if (details.includes("leadsourceoption")) return true;
  return false;
}
