import "server-only";

import { TELEPHONY_CALL_SUMMARY_PLACEHOLDER } from "@/lib/telephony-call-placeholder";
import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  isValid,
  parse,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { TZDate } from "@date-fns/tz";
import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { normalizeStoredAccentHex, normalizeStoredAccentKey } from "@/lib/call-result-accents";
import {
  AppointmentStatus,
  CallDirection,
  getSupabaseAdmin,
  GoogleSyncStatus,
  ImportRowStatus,
  ImportStatus,
  newId,
  OpportunityStatus,
  tables,
  UserRole,
} from "@/lib/db";
import type { PrivilegeOverrides } from "@/lib/user-privileges";
import { getCalendarV3WithRefreshToken } from "@/lib/google-calendar/client";
import {
  deleteCalendarEvent,
  deleteCalendarEventWithRefreshToken,
  insertCalendarEvent,
  insertCalendarEventWithRefreshToken,
  listCalendarEventsWithRefreshToken,
  patchCalendarEvent,
  patchCalendarEventWithRefreshToken,
} from "@/lib/google-calendar/events";
import { getAppTimezone, getGoogleCalendarIdFromEnv, getGoogleRefreshToken } from "@/lib/google-calendar/env";
import { resolveAppointmentGoogleSync, resolveUserGoogleCalendarId } from "@/lib/google-calendar/sync-config";
import {
  CALENDAR_ENTRY_KINDS,
  type AppointmentEditorModel,
  type AppointmentFormClientOption,
  type ClientPhoneMatch,
  PAYMENT_EVENT_KINDS,
  PAYMENT_EVENT_METHODS,
  type PaymentEventView,
} from "@/lib/crm-types";
import {
  resolveProductServiceCodeFromHaystack,
  type ProductServiceResolveRow,
} from "@/lib/product-service-resolve";
import { paymentBadgeLabelForKindsList } from "@/lib/payment-badges";
import {
  assertCallLogPhoneValid,
  assertContactNameValid,
  normalizeCallLogPhoneDigits,
} from "@/lib/call-contact-validation";
import { normalizePhone } from "@/lib/phone";
import { telephonyResultLabelImpliesAnsweredConnected } from "@/lib/ringcentral/call-result";
import {
  isLeadSourceFallbackActiveCode,
  isMissingLeadSourceRelationError,
  LEAD_SOURCE_BUILTIN_FALLBACK,
  leadSourceFallbackLabel,
  type LeadSourceBuiltinRow,
} from "@/lib/lead-source-fallback";
import { UserInputError } from "@/lib/user-input-error";

const zCallDirection = z.enum(["INBOUND", "OUTBOUND"]);
function sb(): SupabaseClient {
  return getSupabaseAdmin();
}

/**
 * Parses timestamps from Postgres `timestamp without time zone` / Supabase.
 * We always write UTC via `.toISOString()`; the DB returns naive strings like `2026-04-03T00:00:00`.
 * `new Date("...T...")` without a zone is treated as *local* in JS, which shifts instants vs UTC
 * (e.g. evening bookings jump to midnight / next calendar day after refresh).
 */
function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (!s) return new Date(NaN);
  if (/[zZ]|[+-]\d{2}:?\d{2}\s*$/.test(s)) {
    return new Date(s);
  }
  const iso = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(iso)) {
    return new Date(`${iso}Z`);
  }
  return new Date(s);
}

/** One product/service + quote row on a call (after resolve + persist). */
export type CallLogProductLineView = {
  product: string;
  productDisplay: string;
  priceText: string | null;
};

/** CallLog row with relations as consumed by dashboard / client UI. */
export type CallLogWithRelations = {
  id: string;
  clientId: string;
  userId: string;
  direction: CallDirection;
  outcomeCode: string;
  summary: string;
  contactPhone: string | null;
  contactName: string | null;
  vehicleText: string | null;
  product: string | null;
  /** Resolved label for `product` code when configured in Workspace. */
  productDisplay: string | null;
  priceText: string | null;
  /** All product/quote lines (legacy calls use a single derived row). */
  productQuoteLines: CallLogProductLineView[];
  source: string | null;
  /** Resolved label when `source` matches `LeadSourceOption`; otherwise the raw stored string. */
  sourceDisplay: string | null;
  callbackNotes: string | null;
  internalNotes: string | null;
  happenedAt: Date;
  followUpAt: Date | null;
  createdAt: Date;
  client: { id: string; displayName: string };
  user: { id: string; name: string; email: string; role: string };
  resultOption: { code: string; label: string; accentKey?: string | null; accentHex?: string | null } | null;
  ringCentralCallLogId: string | null;
  telephonyRecordingId: string | null;
  telephonyRecordingContentUri: string | null;
  telephonyMetadata: Record<string, unknown> | null;
  telephonyTranscript: string | null;
  telephonyAiSummary: string | null;
  telephonyDraft: boolean;
  telephonyAiJobId: string | null;
  telephonyResult: string | null;
  telephonyCallbackPending: boolean;
  /** Set when staff uses Call history → Open log (disables repeat clicks). */
  openedFromCallHistoryAt: Date | null;
};

async function fetchUsersByIds(ids: string[]) {
  const map = new Map<string, { id: string; name: string; email: string; role: string; team: string | null }>();
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return map;
  const { data, error } = await sb().from(tables.User).select("id,name,email,role,team").in("id", uniq);
  if (error) throw error;
  for (const u of data ?? []) map.set(u.id, u);
  return map;
}

export async function fetchClientsByIds(ids: string[]) {
  const map = new Map<string, { id: string; displayName: string }>();
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return map;
  const { data, error } = await sb().from(tables.Client).select("id,displayName").in("id", uniq);
  if (error) throw error;
  for (const c of data ?? []) map.set(c.id, c);
  return map;
}

/** One display phone per client (primary when set, else first phone). */
export async function fetchPrimaryPhoneDisplayByClientIds(clientIds: string[]): Promise<Map<string, string | null>> {
  const m = new Map<string, string | null>();
  const uniq = [...new Set(clientIds)].filter(Boolean);
  for (const id of uniq) m.set(id, null);
  if (!uniq.length) return m;
  const { data, error } = await sb()
    .from(tables.ContactPoint)
    .select("clientId, value, isPrimary")
    .eq("kind", "PHONE")
    .in("clientId", uniq);
  if (error) throw error;
  const byClient = new Map<string, Array<{ value: string; isPrimary: boolean }>>();
  for (const row of data ?? []) {
    const cid = row.clientId as string;
    if (!byClient.has(cid)) byClient.set(cid, []);
    byClient.get(cid)!.push({
      value: String(row.value ?? ""),
      isPrimary: Boolean(row.isPrimary),
    });
  }
  for (const cid of uniq) {
    const rows = byClient.get(cid) ?? [];
    const pick = rows.find((r) => r.isPrimary) ?? rows[0];
    const v = pick?.value?.trim();
    m.set(cid, v && v.length > 0 ? v : null);
  }
  return m;
}

async function fetchResultOptionsByCodes(codes: string[]) {
  const map = new Map<string, { code: string; label: string; accentKey: string | null; accentHex: string | null }>();
  const uniq = [...new Set(codes)].filter(Boolean);
  if (!uniq.length) return map;
  // Use * so older DBs without accentHex (or accentKey) columns don’t throw 42703 — e.g. when /clients prefetches client cards.
  const { data, error } = await sb().from(tables.CallResultOption).select("*").in("code", uniq);
  if (error) throw error;
  for (const r of data ?? []) {
    const row = r as { code: string; label: string; accentKey?: string | null; accentHex?: string | null };
    map.set(row.code, {
      code: row.code,
      label: row.label,
      accentKey: row.accentKey ?? null,
      accentHex: normalizeStoredAccentHex(row.accentHex),
    });
  }
  return map;
}

function priceDigitsForCallLog(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "").trim();
}

/** Client form payload: JSON array of { product, priceText } (raw labels / digits). */
export function parseClientProductQuoteLinesJson(
  jsonRaw: string | undefined | null,
): Array<{ product: string; priceText: string }> {
  const s = String(jsonRaw ?? "").trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const o = item as Record<string, unknown>;
        return {
          product: String(o.product ?? ""),
          priceText: String(o.priceText ?? ""),
        };
      })
      .filter((r) => r.product.trim() || r.priceText.trim());
  } catch {
    return [];
  }
}

function parseStoredProductQuoteLinesDb(raw: unknown): Array<{ product: string; priceText: string | null }> | null {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Array<{ product: string; priceText: string | null }> = [];
  for (const item of raw) {
    const o = item as Record<string, unknown>;
    const product = String(o.product ?? "").trim();
    const ptRaw = o.priceText;
    const priceText =
      ptRaw == null || String(ptRaw).trim() === "" ? null : priceDigitsForCallLog(String(ptRaw)) || String(ptRaw).trim();
    if (product || priceText) {
      out.push({ product: product || "GENERAL", priceText });
    }
  }
  return out.length ? out : null;
}

export type LeadSourceOptionRowView = {
  code: string;
  label: string;
  sortOrder: number;
  isBuiltIn: boolean;
  active: boolean;
  createdAt: Date;
};

function mapBuiltinLeadSources(rows: LeadSourceBuiltinRow[]): LeadSourceOptionRowView[] {
  const list = rows.slice().sort((a, b) => {
    const so = a.sortOrder - b.sortOrder;
    if (so !== 0) return so;
    return a.label.localeCompare(b.label);
  });
  return list.map((r) => ({
    code: r.code,
    label: r.label,
    sortOrder: r.sortOrder,
    isBuiltIn: r.isBuiltIn,
    active: r.active,
    createdAt: toDate(r.createdAt),
  }));
}

function mapDbLeadSources(rows: Record<string, unknown>[]): LeadSourceOptionRowView[] {
  const list = rows.slice().sort((a, b) => {
    const so = (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    if (so !== 0) return so;
    return String(a.label).localeCompare(String(b.label));
  });
  return list.map((r) => ({
    code: String(r.code),
    label: String(r.label),
    sortOrder: Number(r.sortOrder ?? 0),
    isBuiltIn: Boolean(r.isBuiltIn),
    active: Boolean(r.active),
    createdAt: toDate(r.createdAt as string),
  }));
}

export async function getLeadSourceOptions(activeOnly = true): Promise<LeadSourceOptionRowView[]> {
  let q = sb().from(tables.LeadSourceOption).select("*").order("sortOrder", { ascending: true });
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) {
    if (isMissingLeadSourceRelationError(error)) {
      const rows = LEAD_SOURCE_BUILTIN_FALLBACK.filter((r) => !activeOnly || r.active);
      return mapBuiltinLeadSources(rows);
    }
    throw error;
  }
  return mapDbLeadSources((data ?? []) as Record<string, unknown>[]);
}

export async function requireActiveLeadSourceCode(code: string) {
  const { data, error } = await sb()
    .from(tables.LeadSourceOption)
    .select("code")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    if (isMissingLeadSourceRelationError(error)) {
      if (!isLeadSourceFallbackActiveCode(code)) {
        throw new UserInputError(
          "That lead source is not available. Pick another or add it under Workspace → Lead sources.",
        );
      }
      return;
    }
    throw error;
  }
  if (!data) {
    throw new UserInputError(
      "That lead source is not available. Pick another or add it under Workspace → Lead sources.",
    );
  }
}

export async function createCustomLeadSourceOption(label: string) {
  const trimmed = label.trim();
  if (trimmed.length < 2) {
    throw new UserInputError("Enter a label with at least 2 characters.");
  }
  const { data: maxRows, error: maxErr } = await sb()
    .from(tables.LeadSourceOption)
    .select("sortOrder")
    .order("sortOrder", { ascending: false })
    .limit(1);
  if (maxErr) throw maxErr;
  const sortOrder = ((maxRows?.[0]?.sortOrder as number) ?? 0) + 10;
  const code = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    code,
    label: trimmed,
    sortOrder,
    isBuiltIn: false,
    active: true,
    createdAt: nowIso(),
  };
  const { data, error } = await sb().from(tables.LeadSourceOption).insert(row).select("*").single();
  if (error) throw error;
  return { ...data, createdAt: toDate(data.createdAt as string) };
}

export async function updateLeadSourceOptionLabel(code: string, label: string) {
  const trimmed = label.trim();
  if (trimmed.length < 2) {
    throw new UserInputError("Enter a label with at least 2 characters.");
  }
  const { error } = await sb().from(tables.LeadSourceOption).update({ label: trimmed }).eq("code", code);
  if (error) throw error;
}

export async function setLeadSourceOptionActive(code: string, active: boolean) {
  const { error } = await sb().from(tables.LeadSourceOption).update({ active }).eq("code", code);
  if (error) throw error;
}

export async function removeCustomLeadSourceOption(code: string) {
  const { data: row, error: fErr } = await sb().from(tables.LeadSourceOption).select("*").eq("code", code).maybeSingle();
  if (fErr) throw fErr;
  if (!row) {
    throw new Error("Option not found.");
  }
  if (row.isBuiltIn) {
    throw new Error("Built-in lead sources cannot be deleted.");
  }
  const { count, error: cErr } = await sb()
    .from(tables.CallLog)
    .select("*", { count: "exact", head: true })
    .eq("source", code);
  if (cErr) throw cErr;
  const inUse = (count ?? 0) > 0;
  if (inUse) {
    const { error } = await sb().from(tables.LeadSourceOption).update({ active: false }).eq("code", code);
    if (error) throw error;
    return "deactivated" as const;
  }
  const { error: dErr } = await sb().from(tables.LeadSourceOption).delete().eq("code", code);
  if (dErr) throw dErr;
  return "deleted" as const;
}

function resolveCallLogSourceDisplay(raw: string | null, leadLabelByCode: Map<string, string>): string | null {
  if (raw == null || raw === "") return null;
  return leadLabelByCode.get(raw) ?? raw;
}

async function hydrateCallLogs(rows: Record<string, unknown>[]): Promise<CallLogWithRelations[]> {
  if (!rows.length) return [];
  const clientIds = rows.map((r) => r.clientId as string);
  const userIds = rows.map((r) => r.userId as string);
  const codes = rows.map((r) => r.outcomeCode as string);
  const [clients, users, options, productLabels, leadSourceRows] = await Promise.all([
    fetchClientsByIds(clientIds),
    fetchUsersByIds(userIds),
    fetchResultOptionsByCodes(codes),
    getProductServiceLabelMap(),
    getLeadSourceOptions(false),
  ]);
  const leadLabelByCode = new Map(leadSourceRows.map((r) => [String(r.code), String(r.label)]));
  return rows.map((row) => {
    const client = clients.get(row.clientId as string);
    const user = users.get(row.userId as string);
    if (!client || !user) {
      throw new Error("Missing related Client or User for CallLog.");
    }
    const base = row as Record<string, unknown>;
    const pcode = (base.product as string | null) ?? null;
    const productDisplay = pcode ? (productLabels.get(pcode) ?? pcode) : null;
    const legacyPrice = (base.priceText as string | null) ?? null;

    const storedLines = parseStoredProductQuoteLinesDb(base.productQuoteLines);
    let productQuoteLines: CallLogProductLineView[];
    if (storedLines?.length) {
      productQuoteLines = storedLines.map((l) => ({
        product: l.product,
        productDisplay: productLabels.get(l.product) ?? l.product,
        priceText: l.priceText,
      }));
    } else if (pcode || legacyPrice) {
      productQuoteLines = [
        {
          product: pcode ?? "GENERAL",
          productDisplay: (pcode ? productLabels.get(pcode) : null) ?? pcode ?? "GENERAL",
          priceText: legacyPrice,
        },
      ];
    } else {
      productQuoteLines = [];
    }

    return {
      ...base,
      id: base.id as string,
      clientId: base.clientId as string,
      userId: base.userId as string,
      direction: base.direction as CallDirection,
      outcomeCode: base.outcomeCode as string,
      summary: base.summary as string,
      contactPhone: (base.contactPhone as string | null) ?? null,
      contactName: (base.contactName as string | null) ?? null,
      vehicleText: (base.vehicleText as string | null) ?? null,
      product: pcode,
      productDisplay,
      priceText: legacyPrice,
      productQuoteLines,
      source: (base.source as string | null) ?? null,
      sourceDisplay: resolveCallLogSourceDisplay((base.source as string | null) ?? null, leadLabelByCode),
      callbackNotes: (base.callbackNotes as string | null) ?? null,
      internalNotes: (base.internalNotes as string | null) ?? null,
      happenedAt: toDate(row.happenedAt as string),
      followUpAt: row.followUpAt ? toDate(row.followUpAt as string) : null,
      createdAt: toDate(row.createdAt as string),
      client,
      user,
      resultOption: options.get(row.outcomeCode as string) ?? null,
      ringCentralCallLogId: (base.ringCentralCallLogId as string | null) ?? null,
      telephonyRecordingId: (base.telephonyRecordingId as string | null) ?? null,
      telephonyRecordingContentUri: (base.telephonyRecordingContentUri as string | null) ?? null,
      telephonyMetadata:
        base.telephonyMetadata && typeof base.telephonyMetadata === "object" && !Array.isArray(base.telephonyMetadata)
          ? (base.telephonyMetadata as Record<string, unknown>)
          : null,
      telephonyTranscript: (base.telephonyTranscript as string | null) ?? null,
      telephonyAiSummary: (base.telephonyAiSummary as string | null) ?? null,
      telephonyDraft: Boolean(base.telephonyDraft),
      telephonyAiJobId: (base.telephonyAiJobId as string | null) ?? null,
      telephonyResult: (base.telephonyResult as string | null) ?? null,
      telephonyCallbackPending: Boolean(base.telephonyCallbackPending),
      openedFromCallHistoryAt: base.openedFromCallHistoryAt
        ? toDate(base.openedFromCallHistoryAt as string)
        : null,
    };
  });
}

/** Validates log-a-call payloads; outcomeCode maps to CallResultOption rows. */
export const callLogSchema = z.object({
  clientId: z.string().optional(),
  callLogId: z.string().optional(),
  forceNewClient: z.boolean().optional(),
  happenedAt: z.string().optional(),
  contactPhone: z.string().optional(),
  contactName: z.string().min(1),
  vehicleText: z.string().optional(),
  product: z.string().optional(),
  priceText: z.string().optional(),
  productQuoteLinesJson: z.string().optional(),
  callbackNotes: z.string().optional(),
  source: z.string().optional(),
  summary: z.string().trim().min(1, "Add a short note about what happened on the call."),
  internalNotes: z.string().optional(),
  direction: zCallDirection,
  outcomeCode: z.string().min(1, "Pick a call result."),
  followUpAt: z.string().optional(),
});

export { CALENDAR_ENTRY_KINDS };
export type { AppointmentEditorModel, AppointmentFormClientOption, CalendarEntryKind } from "@/lib/crm-types";

export function parseGuestEmailsFromRaw(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

export function toGoogleRecurrenceArray(rule: string | null | undefined): string[] | null {
  if (!rule?.trim()) return null;
  const t = rule.trim();
  if (t.startsWith("RRULE:")) return [t];
  if (t === "DAILY") return ["RRULE:FREQ=DAILY"];
  if (t === "WEEKLY") return ["RRULE:FREQ=WEEKLY"];
  if (t === "MONTHLY") return ["RRULE:FREQ=MONTHLY"];
  return null;
}

function normalizeAppointmentDepositText(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "").trim();
  return d.length > 0 ? d : null;
}

/** Google event description: CRM notes plus a `deposit - $500` line when a deposit is set (notes in DB stay unchanged). */
function googleCalendarDescriptionForAppointment(
  notes: string | null | undefined,
  depositDigits: string | null | undefined,
): string | null {
  const notePart = notes?.trim() ?? "";
  const dep = normalizeAppointmentDepositText(depositDigits ?? null);
  const depLine = dep ? `deposit - ${/^\d+$/.test(dep) ? `$${dep}` : dep}` : "";
  const parts: string[] = [];
  if (notePart) parts.push(notePart);
  if (depLine) parts.push(depLine);
  if (!parts.length) return null;
  return parts.join("\n\n");
}

export function googleCalendarSummaryForCrmTitle(title: string, kind: string): string {
  const trimmed = title.trim();
  if (kind === "TASK") return trimmed.startsWith("[Task]") ? trimmed : `[Task] ${trimmed}`;
  if (kind === "APPOINTMENT_SCHEDULE") {
    return trimmed.startsWith("[Schedule]") ? trimmed : `[Schedule] ${trimmed}`;
  }
  return trimmed;
}

export const appointmentSchema = z.object({
  clientId: z.string().min(1),
  vehicleId: z.string().optional(),
  title: z.string().min(4),
  type: z.string().min(1, "Pick a booking type."),
  startAt: z.string().min(1),
  durationMins: z.coerce.number().min(15).max(480),
  resourceKey: z.string().min(1),
  notes: z.string().optional(),
  calendarEntryKind: z.enum(["EVENT", "TASK", "APPOINTMENT_SCHEDULE"]).default("EVENT"),
  location: z.string().nullable().optional(),
  guestEmails: z.string().nullable().optional(),
  allDay: z.boolean().optional().default(false),
  recurrenceRule: z.string().nullable().optional(),
  showAs: z.enum(["busy", "free"]).default("busy"),
  visibility: z.enum(["default", "public", "private", "confidential"]).default("default"),
  depositText: z.string().nullable().optional(),
  callLogId: z.string().nullable().optional(),
});

export const paymentEventCreateSchema = z.object({
  clientId: z.string().min(1),
  appointmentId: z.string().nullable().optional(),
  callLogId: z.string().nullable().optional(),
  kind: z.enum(PAYMENT_EVENT_KINDS),
  amountCents: z.coerce.number().int().positive(),
  receivedAt: z.string().min(1),
  method: z.enum(PAYMENT_EVENT_METHODS),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const paymentEventUpdateSchema = paymentEventCreateSchema.extend({
  paymentEventId: z.string().min(1),
});

export const updateAppointmentSchema = z.object({
  appointmentId: z.string().min(1),
  clientId: z.string().min(1),
  vehicleId: z.string().optional(),
  title: z.string().min(4),
  type: z.string().min(1),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  resourceKey: z.string().min(1),
  notes: z.string().nullable().optional(),
  calendarEntryKind: z.enum(["EVENT", "TASK", "APPOINTMENT_SCHEDULE"]).default("EVENT"),
  location: z.string().nullable().optional(),
  guestEmails: z.string().nullable().optional(),
  allDay: z.boolean().optional().default(false),
  recurrenceRule: z.string().nullable().optional(),
  showAs: z.enum(["busy", "free"]).default("busy"),
  visibility: z.enum(["default", "public", "private", "confidential"]).default("default"),
  depositText: z.string().nullable().optional(),
});

export const importCsvSchema = z.object({
  fileName: z.string().min(1),
  csvText: z
    .string()
    .transform((s) => s.replace(/^\uFEFF/, "").trim())
    .pipe(z.string().min(1, "CSV file is empty or whitespace only")),
});

function parseVehicleLabel(label?: string | null) {
  if (!label) {
    return { label: "Unknown vehicle", year: null, make: null, model: null };
  }

  const trimmed = label.trim().replace(/\s+/g, " ");
  const [yearToken, makeToken, ...modelTokens] = trimmed.split(" ");
  const year = Number(yearToken);

  if (!Number.isNaN(year) && year > 1900) {
    return {
      label: trimmed,
      year,
      make: makeToken ?? null,
      model: modelTokens.join(" ") || null,
    };
  }

  return {
    label: trimmed,
    year: null,
    make: yearToken ?? null,
    model: [makeToken, ...modelTokens].filter(Boolean).join(" ") || null,
  };
}

function inferOutcome(text: string): string {
  const content = text.toLowerCase();
  if (/\b(book(ed|ing)?|booked|reservation|scheduled install)\b/.test(content)) return "BOOKED";
  if (
    content.includes("left message") ||
    content.includes("voice mail") ||
    content.includes("voicemail") ||
    content.includes("no answer") ||
    content.includes("no voice mail")
  ) {
    return "CALLBACK_NEEDED";
  }
  if (/\b(call back|callback|call-back)\b/.test(content)) return "CALLBACK_NEEDED";
  if (content.includes("follow up")) return "FOLLOW_UP";
  if (content.includes("support")) return "SUPPORT";
  if (
    /\bcompleted\b/.test(content) ||
    /\bjob\s+done\b/.test(content) ||
    /\bwork\s+done\b/.test(content) ||
    /\bclosed\s+out\b/.test(content)
  ) {
    return "COMPLETED";
  }
  if (content.includes("no solution")) return "NO_SOLUTION";
  return "QUOTE_SENT";
}

function inferOpportunityStatus(text: string) {
  const content = text.toLowerCase();
  if (/\b(book(ed|ing)?|booked|reservation)\b/.test(content)) return OpportunityStatus.BOOKED;
  if (content.includes("support")) return OpportunityStatus.SUPPORT;
  if (/\bcompleted\b/.test(content) || /\b(won|sold)\b/.test(content)) return OpportunityStatus.WON;
  return OpportunityStatus.QUOTED;
}

/** Parses Google Sheets / Excel style dates like 3/2/2026 and times like 10:10:36 AM */
function csvToDate(dateRaw?: string, timeRaw?: string) {
  const dateStr = dateRaw?.trim() ?? "";
  const timeStr = timeRaw?.trim() ?? "";

  const looksLikeUsDate = (s: string) => /^\d{1,2}\/\d{1,2}\/\d{4}/.test(s);
  const looksLikeTimeOnly = (s: string) => /^\d{1,2}:\d{2}/.test(s) && !looksLikeUsDate(s);

  let dPart = dateStr;
  let tPart = timeStr;
  if (!looksLikeUsDate(dPart) && looksLikeUsDate(tPart)) {
    dPart = tPart;
    tPart = "";
  }
  if (looksLikeTimeOnly(dPart) && looksLikeUsDate(tPart)) {
    dPart = tPart;
    tPart = dateStr;
  }

  if (!dPart || !looksLikeUsDate(dPart)) {
    return new Date();
  }

  const tryCombo = (combo: string, fmt: string) => {
    const p = parse(combo, fmt, new Date());
    return isValid(p) ? p : null;
  };

  const combos = tPart && looksLikeTimeOnly(tPart) ? [`${dPart} ${tPart}`] : [dPart];
  const formats = ["M/d/yyyy h:mm:ss a", "M/d/yyyy h:mm a", "M/d/yyyy H:mm:ss", "M/d/yyyy"];

  for (const combo of combos) {
    for (const fmt of formats) {
      const p = tryCombo(combo, fmt);
      if (p) return p;
    }
  }

  const fallback = new Date(tPart ? `${dPart} ${tPart}` : dPart);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

const nowIso = () => new Date().toISOString();

function openCallTasksCountQuery() {
  return sb()
    .from(tables.CallLog)
    .select("id", { count: "exact", head: true })
    .not("outcomeCode", "eq", "COMPLETED")
    .not("outcomeCode", "eq", "BOOKED")
    .not("outcomeCode", "eq", "NO_SOLUTION")
    .not("outcomeCode", "eq", "ARCHIVED")
    .or("followUpAt.not.is.null,outcomeCode.in.(CALLBACK_NEEDED,FOLLOW_UP),telephonyCallbackPending.eq.true");
}

export async function getDashboardData() {
  const now = new Date();
  const tomorrow = addMinutes(startOfDay(now), 24 * 60);
  const dayStart = startOfDay(now).toISOString();
  const dayEnd = tomorrow.toISOString();
  const callsWindowStart = subDays(now, 7).toISOString();

  const [
    { count: clientCount, error: countErr },
    { count: openCallTasksCount, error: openTasksErr },
    { count: dueTodayFollowUpCount, error: dueTodayErr },
    { count: callsLast7dCount, error: calls7Err },
    { count: bookedLast7dCount, error: booked7Err },
    { count: supportLast7dCount, error: support7Err },
  ] = await Promise.all([
    sb().from(tables.Client).select("*", { count: "exact", head: true }),
    openCallTasksCountQuery(),
    sb()
      .from(tables.CallLog)
      .select("id", { count: "exact", head: true })
      .not("outcomeCode", "eq", "COMPLETED")
      .not("outcomeCode", "eq", "BOOKED")
      .not("outcomeCode", "eq", "NO_SOLUTION")
      .not("outcomeCode", "eq", "ARCHIVED")
      .not("followUpAt", "is", null)
      .gte("followUpAt", dayStart)
      .lt("followUpAt", dayEnd),
    sb()
      .from(tables.CallLog)
      .select("id", { count: "exact", head: true })
      .gte("happenedAt", callsWindowStart),
    sb()
      .from(tables.CallLog)
      .select("id", { count: "exact", head: true })
      .gte("happenedAt", callsWindowStart)
      .eq("outcomeCode", "BOOKED"),
    sb()
      .from(tables.CallLog)
      .select("id", { count: "exact", head: true })
      .gte("happenedAt", callsWindowStart)
      .eq("outcomeCode", "SUPPORT"),
  ]);
  if (countErr) throw countErr;
  if (openTasksErr) throw openTasksErr;
  if (dueTodayErr) throw dueTodayErr;
  if (calls7Err) throw calls7Err;
  if (booked7Err) throw booked7Err;
  if (support7Err) throw support7Err;

  const overviewRangeStart = startOfMonth(subMonths(now, 1)).toISOString();
  const overviewRangeEnd = endOfMonth(addMonths(now, 2)).toISOString();
  const { data: appointmentRows, error: aptErr } = await sb()
    .from(tables.Appointment)
    .select("*")
    .gte("startAt", overviewRangeStart)
    .lte("startAt", overviewRangeEnd)
    .not("status", "eq", AppointmentStatus.CANCELLED)
    .order("startAt", { ascending: true })
    .limit(400);
  if (aptErr) throw aptErr;

  const aptList = appointmentRows ?? [];
  const aptClientMap = await fetchClientsByIds(aptList.map((a) => a.clientId as string));
  const appointments = aptList.map((a) => ({
    ...a,
    startAt: toDate(a.startAt as string),
    endAt: toDate(a.endAt as string),
    createdAt: toDate(a.createdAt as string),
    updatedAt: toDate(a.updatedAt as string),
    client: aptClientMap.get(a.clientId as string)!,
  }));

  const { data: recentRows, error: rcErr } = await sb()
    .from(tables.CallLog)
    .select("*")
    .order("happenedAt", { ascending: false })
    .limit(6);
  if (rcErr) throw rcErr;
  const recentCalls = await hydrateCallLogs((recentRows ?? []) as Record<string, unknown>[]);

  const { data: importRows, error: ibErr } = await sb()
    .from(tables.ImportBatch)
    .select("*")
    .order("createdAt", { ascending: false })
    .limit(3);
  if (ibErr) throw ibErr;
  const importBatches = importRows ?? [];

  const { data: userRows, error: uErr } = await sb().from(tables.User).select("*").order("role", { ascending: true });
  if (uErr) throw uErr;
  const users = userRows ?? [];

  const [{ data: allOpps, error: oErr }, productLabels] = await Promise.all([
    sb().from(tables.Opportunity).select("product"),
    getProductServiceLabelMap(),
  ]);
  if (oErr) throw oErr;
  const productCounts = new Map<string, number>();
  for (const o of allOpps ?? []) {
    const p = o.product as string;
    productCounts.set(p, (productCounts.get(p) ?? 0) + 1);
  }
  const opportunities = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([product, _count]) => ({
      product,
      productDisplay: productLabels.get(product) ?? product,
      _count,
    }));

  return {
    totals: {
      clients: clientCount ?? 0,
      appointmentsToday: appointments.filter((entry) => startOfDay(entry.startAt).getTime() === startOfDay(now).getTime())
        .length,
      callsLogged: callsLast7dCount ?? 0,
      /** Open items that match the Tasks → call follow-ups list (callback needed, follow-up, scheduled time, RingCentral callback flag). */
      pendingCallbacks: openCallTasksCount ?? 0,
      dueTodayCallbacks: dueTodayFollowUpCount ?? 0,
      importBatches: importBatches.length,
      bookedCalls: bookedLast7dCount ?? 0,
      supportCalls: supportLast7dCount ?? 0,
      needsFollowUp: openCallTasksCount ?? 0,
    },
    appointments,
    callbacks: [],
    dueTodayCallbacks: [],
    recentCalls,
    importBatches,
    users,
    opportunities,
  };
}

/** Call outcomes that close the loop — excluded from the open tasks queue. */
const TASK_CLOSED_CALL_OUTCOMES = new Set(["COMPLETED", "BOOKED", "NO_SOLUTION", "ARCHIVED"]);

export type TaskAppointmentRow = {
  /** CRM row vs Google-only event (already-synced CRM bookings stay source crm). */
  source: "crm" | "google";
  id: string;
  clientId: string | null;
  clientDisplayName: string;
  title: string;
  type: string;
  typeLabel: string;
  status: string;
  startAt: Date;
  endAt: Date;
  resourceKey: string;
  /** Open in Google Calendar when present (Google-only rows). */
  googleHtmlLink: string | null;
  /** CRM only: deposit / payment tag for task lists (PaymentEvent and/or booking deposit text). */
  moneyTagLabel: string | null;
};

export type GetTasksQueueGoogleOpts = {
  googleRefreshToken: string | null | undefined;
  googleCalendarId: string | null | undefined;
};

/** Same calendar list credentials as Bookings: user OAuth first, else shop env token. */
function resolveTasksGoogleListing(googleUser?: GetTasksQueueGoogleOpts | null): {
  refreshToken: string;
  calendarId: string;
} | null {
  const userRt = googleUser?.googleRefreshToken?.trim();
  if (userRt) {
    return {
      refreshToken: userRt,
      calendarId: resolveUserGoogleCalendarId(googleUser?.googleCalendarId),
    };
  }
  const envRt = getGoogleRefreshToken()?.trim();
  if (envRt) {
    return { refreshToken: envRt, calendarId: getGoogleCalendarIdFromEnv() ?? "primary" };
  }
  return null;
}

/** All-day create: interpret the client’s instant in APP_TIMEZONE so server UTC doesn’t shift the calendar day. */
function allDayBoundsInAppTimezone(instant: Date): { start: Date; end: Date } {
  const tz = getAppTimezone();
  const anchor = new TZDate(instant.getTime(), tz);
  const s = startOfDay(anchor);
  const e = endOfDay(anchor);
  return { start: new Date(s.getTime()), end: new Date(e.getTime()) };
}

/** 60-day window in APP_TIMEZONE so server UTC ≠ shop local day doesn’t hide events. */
function tasksQueueAppointmentWindow() {
  const tz = getAppTimezone();
  const todayStart = startOfDay(new TZDate(Date.now(), tz));
  const lastIncludedDayStart = addDays(todayStart, 59);
  const rangeEndInclusive = endOfDay(lastIncludedDayStart);
  const googleTimeMaxExclusive = addDays(lastIncludedDayStart, 1);
  return {
    rangeStartIso: todayStart.toISOString(),
    rangeEndInclusiveIso: rangeEndInclusive.toISOString(),
    googleTimeMin: new Date(todayStart.getTime()),
    googleTimeMaxExclusive: new Date(googleTimeMaxExclusive.getTime()),
  };
}

/** Manual outcomes that mean “we handled this customer” — older RingCentral missed/voicemail stubs can leave the task queue. */
const OUTCOMES_CLEARING_OLDER_RC_CALLBACK_BURST = new Set(["BOOKED", "COMPLETED", "NO_SOLUTION"]);

/**
 * Tasks queue: one visible row per client + phone for open RingCentral callback bursts (newest stub wins).
 * Timeline rows stay in the DB until reconciliation archives them; this avoids four identical tasks for four rapid misses.
 */
function dedupeOpenRcCallbackBurstTasks(tasks: CallLogWithRelations[]): CallLogWithRelations[] {
  const groupKey = (t: CallLogWithRelations): string | null => {
    const rc = Boolean(t.ringCentralCallLogId?.trim());
    if (!rc) return null;
    const open = t.outcomeCode === "CALLBACK_NEEDED" || t.telephonyCallbackPending;
    if (!open) return null;
    const phone = normalizePhone(t.contactPhone ?? "");
    return `${t.clientId}\0${phone || ""}`;
  };

  const winners = new Map<string, CallLogWithRelations>();
  for (const t of tasks) {
    const k = groupKey(t);
    if (!k) continue;
    const prev = winners.get(k);
    if (
      !prev ||
      t.happenedAt.getTime() > prev.happenedAt.getTime() ||
      (t.happenedAt.getTime() === prev.happenedAt.getTime() && t.id > prev.id)
    ) {
      winners.set(k, t);
    }
  }
  const keep = new Set([...winners.values()].map((w) => w.id));

  return tasks.filter((t) => {
    const k = groupKey(t);
    if (!k) return true;
    return keep.has(t.id);
  });
}

/**
 * Job-style task list: call callbacks / follow-ups and upcoming CRM + Google-only bookings.
 */
export async function getTasksQueue(googleUser?: GetTasksQueueGoogleOpts | null): Promise<{
  callTasks: CallLogWithRelations[];
  upcomingAppointments: TaskAppointmentRow[];
  /** Set when Google listing fails or OAuth is misconfigured (CRM rows still return). */
  googleCalendarNotice: string | null;
}> {
  const [{ data: withFollow }, { data: outcomeRows }, { data: telephonyCallbackRows }] = await Promise.all([
    sb()
      .from(tables.CallLog)
      .select("*")
      .not("followUpAt", "is", null)
      .order("followUpAt", { ascending: true })
      .limit(250),
    sb()
      .from(tables.CallLog)
      .select("*")
      .in("outcomeCode", ["CALLBACK_NEEDED", "FOLLOW_UP"])
      .order("happenedAt", { ascending: false })
      .limit(250),
    sb()
      .from(tables.CallLog)
      .select("*")
      .eq("telephonyCallbackPending", true)
      .order("happenedAt", { ascending: false })
      .limit(250),
  ]);

  const byId = new Map<string, Record<string, unknown>>();
  for (const r of [...(withFollow ?? []), ...(outcomeRows ?? []), ...(telephonyCallbackRows ?? [])]) {
    const row = r as Record<string, unknown>;
    if (TASK_CLOSED_CALL_OUTCOMES.has(row.outcomeCode as string)) continue;
    byId.set(row.id as string, row);
  }

  const raw = [...byId.values()];
  raw.sort((a, b) => {
    const fa = a.followUpAt ? new Date(a.followUpAt as string).getTime() : Number.POSITIVE_INFINITY;
    const fb = b.followUpAt ? new Date(b.followUpAt as string).getTime() : Number.POSITIVE_INFINITY;
    if (fa !== fb) return fa - fb;
    return new Date(b.happenedAt as string).getTime() - new Date(a.happenedAt as string).getTime();
  });

  const callTasks = dedupeOpenRcCallbackBurstTasks(await hydrateCallLogs(raw.slice(0, 200)));

  const win = tasksQueueAppointmentWindow();

  let googleCalendarNotice: string | null = null;

  const [{ data: aptRows, error: aErr }, { data: typeOpts }] = await Promise.all([
    sb()
      .from(tables.Appointment)
      .select("*")
      .gte("startAt", win.rangeStartIso)
      .lte("startAt", win.rangeEndInclusiveIso)
      .not("status", "eq", "CANCELLED")
      .order("startAt", { ascending: true })
      .limit(200),
    sb().from(tables.BookingTypeOption).select("code,label"),
  ]);
  if (aErr) throw aErr;

  const typeLabels = new Map((typeOpts ?? []).map((o) => [o.code as string, String(o.label)]));
  const aptList = aptRows ?? [];
  const aptClientIds = [...new Set(aptList.map((a) => a.clientId as string))];
  const aptClientMap = await fetchClientsByIds(aptClientIds);

  const aptIds = aptList.map((a) => a.id as string).filter(Boolean);
  const paymentKindsByAppointmentId = new Map<string, string[]>();
  if (aptIds.length) {
    const { data: peRows, error: peErr } = await sb()
      .from(tables.PaymentEvent)
      .select("appointmentId, kind")
      .in("appointmentId", aptIds);
    if (peErr) throw peErr;
    for (const r of peRows ?? []) {
      const aid = r.appointmentId as string | null;
      if (!aid) continue;
      if (!paymentKindsByAppointmentId.has(aid)) paymentKindsByAppointmentId.set(aid, []);
      paymentKindsByAppointmentId.get(aid)!.push(String(r.kind));
    }
  }

  const syncedGoogleEventIds = new Set(
    aptList.map((a) => (a.googleEventId as string | null)?.trim()).filter(Boolean) as string[],
  );

  const crmAppointments: TaskAppointmentRow[] = aptList
    .map((a): TaskAppointmentRow | null => {
      const c = aptClientMap.get(a.clientId as string);
      if (!c) return null;
      const code = a.type as string;
      const aid = a.id as string;
      const fromEvents = paymentBadgeLabelForKindsList(paymentKindsByAppointmentId.get(aid) ?? []);
      const depositText = String((a as { depositText?: string | null }).depositText ?? "").trim();
      const moneyTagLabel = fromEvents ?? (depositText ? "Deposit noted" : null);
      return {
        source: "crm",
        id: aid,
        clientId: a.clientId as string,
        clientDisplayName: c.displayName,
        title: a.title as string,
        type: code,
        typeLabel: typeLabels.get(code) ?? code,
        status: a.status as string,
        startAt: toDate(a.startAt as string),
        endAt: toDate(a.endAt as string),
        resourceKey: String(a.resourceKey ?? ""),
        googleHtmlLink: null,
        moneyTagLabel,
      };
    })
    .filter((x): x is TaskAppointmentRow => x != null);

  let googleOnly: TaskAppointmentRow[] = [];
  const googleCreds = resolveTasksGoogleListing(googleUser);
  if (googleCreds) {
    if (!getCalendarV3WithRefreshToken(googleCreds.refreshToken)) {
      googleCalendarNotice =
        "Google Calendar API client is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / redirect).";
    } else {
      try {
        const rawGoogle = await listCalendarEventsWithRefreshToken(
          googleCreds.refreshToken,
          googleCreds.calendarId,
          win.googleTimeMin,
          win.googleTimeMaxExclusive,
        );
        googleOnly = rawGoogle
          .filter((e) => !syncedGoogleEventIds.has(e.id))
          .map((e) => ({
            source: "google" as const,
            id: `google:${e.id}`,
            clientId: null,
            clientDisplayName: "Google Calendar",
            title: e.summary,
            type: "GOOGLE",
            typeLabel: "Google Calendar",
            status: e.allDay ? "ALL_DAY" : "EXTERNAL",
            startAt: new Date(e.start),
            endAt: new Date(e.end),
            resourceKey: "",
            googleHtmlLink: e.htmlLink ?? null,
            moneyTagLabel: null,
          }));
      } catch (e) {
        googleOnly = [];
        googleCalendarNotice =
          e instanceof Error ? e.message : "Could not load Google Calendar events for Tasks.";
      }
    }
  }

  const upcomingAppointments = [...crmAppointments, ...googleOnly].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  return { callTasks, upcomingAppointments, googleCalendarNotice };
}

function humanizeStatusToken(raw: string): string {
  const s = raw.trim();
  if (!s) return "NEW";
  return s
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export async function getClientsOverview(): Promise<ClientListRow[]> {
  const [clientRes, resultOptions, productLabels] = await Promise.all([
    sb().from(tables.Client).select("*").order("updatedAt", { ascending: false }),
    getCallResultOptions(false),
    getProductServiceLabelMap(),
  ]);
  if (clientRes.error) throw clientRes.error;
  const list = clientRes.data ?? [];
  if (!list.length) return [];

  const outcomeLabelByCode = new Map<string, string>(
    resultOptions.map((o) => [String(o.code), String(o.label ?? o.code)]),
  );

  const ids = list.map((c) => c.id as string);
  const [{ data: cps }, { data: vehs }, { data: logs }, { data: opps }, { data: aptRows }] = await Promise.all([
    sb().from(tables.ContactPoint).select("*").in("clientId", ids).order("isPrimary", { ascending: false }),
    sb().from(tables.Vehicle).select("*").in("clientId", ids),
    sb().from(tables.CallLog).select("*").in("clientId", ids),
    sb().from(tables.Opportunity).select("*").in("clientId", ids),
    sb().from(tables.Appointment).select("clientId, updatedAt").in("clientId", ids),
  ]);

  const maxAptUpdatedByClient = new Map<string, number>();
  for (const row of aptRows ?? []) {
    const cid = row.clientId as string;
    const t = toDate(row.updatedAt as string).getTime();
    const prev = maxAptUpdatedByClient.get(cid) ?? 0;
    if (t > prev) maxAptUpdatedByClient.set(cid, t);
  }

  const cpByClient = new Map<string, typeof cps>();
  for (const p of cps ?? []) {
    const cid = p.clientId as string;
    if (!cpByClient.has(cid)) cpByClient.set(cid, []);
    cpByClient.get(cid)!.push(p);
  }
  const vehByClient = new Map<string, NonNullable<typeof vehs>>();
  for (const v of vehs ?? []) {
    const cid = v.clientId as string;
    if (!vehByClient.has(cid)) vehByClient.set(cid, []);
    vehByClient.get(cid)!.push(v);
  }
  const logByClient = new Map<string, NonNullable<typeof logs>>();
  for (const l of logs ?? []) {
    const cid = l.clientId as string;
    if (!logByClient.has(cid)) logByClient.set(cid, []);
    logByClient.get(cid)!.push(l);
  }
  for (const arr of logByClient.values()) {
    arr.sort((a, b) => {
      const ta = toDate(a.happenedAt as string).getTime();
      const tb = toDate(b.happenedAt as string).getTime();
      if (tb !== ta) return tb - ta;
      return toDate(b.createdAt as string).getTime() - toDate(a.createdAt as string).getTime();
    });
  }
  const oppByClient = new Map<string, NonNullable<typeof opps>>();
  for (const o of opps ?? []) {
    const cid = o.clientId as string;
    if (!oppByClient.has(cid)) oppByClient.set(cid, []);
    oppByClient.get(cid)!.push(o);
  }
  for (const arr of oppByClient.values()) {
    arr.sort(
      (a, b) =>
        toDate(b.updatedAt as string).getTime() - toDate(a.updatedAt as string).getTime() ||
        toDate(b.createdAt as string).getTime() - toDate(a.createdAt as string).getTime(),
    );
  }

  return list.map((c) => {
    const allLogs = logByClient.get(c.id as string) ?? [];
    const latestLog = allLogs[0];
    const oppsForClient = oppByClient.get(c.id as string) ?? [];
    const openStatusLabel = latestLog
      ? outcomeLabelByCode.get(String(latestLog.outcomeCode)) ??
        humanizeStatusToken(String(latestLog.outcomeCode ?? "").replace(/_/g, " "))
      : oppsForClient[0]
        ? humanizeStatusToken(String(oppsForClient[0].status ?? ""))
        : "NEW";

    const updatedAt = toDate(c.updatedAt as string);
    /** Omit client `updatedAt` here — sync/enrichment bumps it and would hide the real call time on the list. */
    const activityTimes: number[] = [];
    if (latestLog) {
      activityTimes.push(toDate(latestLog.happenedAt as string).getTime());
    }
    const topOpp = oppsForClient[0];
    if (topOpp) {
      activityTimes.push(toDate(topOpp.updatedAt as string).getTime());
    }
    const aptT = maxAptUpdatedByClient.get(c.id as string);
    if (aptT) activityTimes.push(aptT);
    const lastActivityAt =
      activityTimes.length > 0 ? new Date(Math.max(...activityTimes)) : updatedAt;

    const recordingUri = latestLog
      ? String((latestLog as { telephonyRecordingContentUri?: string | null }).telephonyRecordingContentUri ?? "").trim()
      : "";

    return {
      ...c,
      createdAt: toDate(c.createdAt as string),
      updatedAt,
      contactPoints: cpByClient.get(c.id as string) ?? [],
      vehicles: vehByClient.get(c.id as string) ?? [],
      callLogs: allLogs.slice(0, 1).map((log) => ({
        ...log,
        happenedAt: toDate(log.happenedAt as string),
        followUpAt: log.followUpAt ? toDate(log.followUpAt as string) : null,
        createdAt: toDate(log.createdAt as string),
      })),
      latestCallHasRecording: Boolean(recordingUri),
      latestTelephonyResult: latestLog
        ? (String((latestLog as { telephonyResult?: string | null }).telephonyResult ?? "").trim() || null)
        : null,
      opportunities: oppsForClient.map((o) => {
        const pcode = String(o.product ?? "");
        return {
          ...o,
          product: pcode,
          productDisplay: productLabels.get(pcode) ?? pcode,
          createdAt: toDate(o.createdAt as string),
          updatedAt: toDate(o.updatedAt as string),
        };
      }),
      openStatusLabel,
      lastActivityAt,
    };
  }) as ClientListRow[];
}

export async function getClientDetail(clientId: string): Promise<ClientDetailView | null> {
  const { data: client, error: cErr } = await sb().from(tables.Client).select("*").eq("id", clientId).maybeSingle();
  if (cErr) throw cErr;
  if (!client) return null;

  await reconcileTelephonyCallbacksIfLatestCallAnswered(clientId);

  const productLabels = await getProductServiceLabelMap();

  const [{ data: contactPoints }, { data: vehicles }, { data: callLogs }, { data: opportunities }, { data: appointments }] =
    await Promise.all([
      sb().from(tables.ContactPoint).select("*").eq("clientId", clientId),
      sb().from(tables.Vehicle).select("*").eq("clientId", clientId),
      sb().from(tables.CallLog).select("*").eq("clientId", clientId).order("happenedAt", { ascending: false }),
      sb().from(tables.Opportunity).select("*").eq("clientId", clientId),
      sb().from(tables.Appointment).select("*").eq("clientId", clientId).order("startAt", { ascending: true }),
    ]);

  const hydratedLogs = await hydrateCallLogs((callLogs ?? []) as Record<string, unknown>[]);

  return {
    ...client,
    createdAt: toDate(client.createdAt as string),
    updatedAt: toDate(client.updatedAt as string),
    contactPoints: contactPoints ?? [],
    vehicles: vehicles ?? [],
    callLogs: hydratedLogs,
    opportunities: (opportunities ?? []).map((o) => {
      const pcode = String(o.product ?? "");
      return {
        ...o,
        product: pcode,
        productDisplay: productLabels.get(pcode) ?? pcode,
        createdAt: toDate(o.createdAt as string),
        updatedAt: toDate(o.updatedAt as string),
      };
    }),
    appointments: (appointments ?? []).map((a) => {
      const vid = (a as { vehicleId?: string | null }).vehicleId ?? null;
      const vehicleList = (vehicles ?? []) as Array<{ id: string; label: string }>;
      const vehicleLabel = vid ? vehicleList.find((v) => v.id === vid)?.label ?? null : null;
      return {
        id: a.id as string,
        title: a.title as string,
        type: a.type as string,
        status: a.status as string,
        startAt: toDate(a.startAt as string),
        endAt: toDate(a.endAt as string),
        resourceKey: (a.resourceKey as string | null) ?? null,
        notes: (a.notes as string | null) ?? null,
        vehicleLabel,
        depositText: ((a as { depositText?: string | null }).depositText as string | null) ?? null,
        callLogId: ((a as { callLogId?: string | null }).callLogId as string | null) ?? null,
      };
    }),
  } as ClientDetailView;
}

export async function getAppointmentsOverview() {
  const [{ data: appointments }, { data: configRow }, { data: users }] = await Promise.all([
    sb().from(tables.Appointment).select("*").order("startAt", { ascending: true }),
    sb().from(tables.CalendarConfig).select("*").limit(1).maybeSingle(),
    sb().from(tables.User).select("*").order("name", { ascending: true }),
  ]);

  const aptList = appointments ?? [];
  const clientIds = [...new Set(aptList.map((a) => a.clientId as string))];
  const vehicleIds = [...new Set(aptList.map((a) => a.vehicleId as string | null).filter(Boolean) as string[])];
  const creatorIds = [...new Set(aptList.map((a) => a.createdById as string))];

  const [clientMap, vehicleMap, userMap, primaryPhoneByClient] = await Promise.all([
    fetchClientsByIds(clientIds),
    (async () => {
      const m = new Map<string, Record<string, unknown>>();
      if (!vehicleIds.length) return m;
      const { data, error } = await sb().from(tables.Vehicle).select("*").in("id", vehicleIds);
      if (error) throw error;
      for (const v of data ?? []) m.set(v.id as string, v);
      return m;
    })(),
    fetchUsersByIds(creatorIds),
    fetchPrimaryPhoneDisplayByClientIds(clientIds),
  ]);

  const enriched = aptList.map((a) => ({
    ...a,
    startAt: toDate(a.startAt as string),
    endAt: toDate(a.endAt as string),
    createdAt: toDate(a.createdAt as string),
    updatedAt: toDate(a.updatedAt as string),
    client: clientMap.get(a.clientId as string)!,
    clientPhone: primaryPhoneByClient.get(a.clientId as string) ?? null,
    vehicle: a.vehicleId ? vehicleMap.get(a.vehicleId as string) ?? null : null,
    createdBy: userMap.get(a.createdById as string)!,
  }));

  const slotUsage = enriched.reduce<Record<string, number>>((acc, appointment) => {
    const key = (appointment.capacitySlot as string | null) ?? appointment.startAt.toISOString();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    appointments: enriched,
    config: configRow ?? null,
    users: users ?? [],
    slotUsage,
  };
}

/** Minimal client + phones + vehicle list for the bookings calendar “create event” dialog. */
export async function getAppointmentFormClients(): Promise<AppointmentFormClientOption[]> {
  const { data: clients, error } = await sb()
    .from(tables.Client)
    .select("id, displayName")
    .order("displayName", { ascending: true });
  if (error) throw error;
  const list = clients ?? [];
  if (!list.length) return [];
  const ids = list.map((c) => c.id as string);
  const [{ data: vehicles, error: vErr }, { data: points, error: pErr }] = await Promise.all([
    sb().from(tables.Vehicle).select("id, clientId, label").in("clientId", ids),
    sb()
      .from(tables.ContactPoint)
      .select("clientId, value, normalizedValue, isPrimary")
      .eq("kind", "PHONE")
      .in("clientId", ids)
      .order("isPrimary", { ascending: false }),
  ]);
  if (vErr) throw vErr;
  if (pErr) throw pErr;

  const phonesByClient = new Map<string, Array<{ value: string; normalized: string }>>();
  for (const p of points ?? []) {
    const cid = p.clientId as string;
    const norm = String((p.normalizedValue as string | null) ?? normalizePhone(p.value as string) ?? "");
    if (!phonesByClient.has(cid)) phonesByClient.set(cid, []);
    phonesByClient.get(cid)!.push({
      value: String(p.value ?? ""),
      normalized: norm,
    });
  }

  const byClient = new Map<string, Array<{ id: string; label: string }>>();
  for (const v of vehicles ?? []) {
    const cid = v.clientId as string;
    if (!byClient.has(cid)) byClient.set(cid, []);
    byClient.get(cid)!.push({ id: v.id as string, label: v.label as string });
  }
  return list.map((c) => ({
    id: c.id as string,
    displayName: c.displayName as string,
    phones: phonesByClient.get(c.id as string) ?? [],
    vehicles: byClient.get(c.id as string) ?? [],
  }));
}

/** Creates a client (and optional primary phone) from the booking dialog when no existing client was chosen. */
export async function createClientForBooking(input: { displayName: string; phone?: string | null }) {
  const displayName = input.displayName.trim();
  if (displayName.length < 2) {
    throw new Error("Client name must be at least 2 characters.");
  }
  const normalizedPhone = normalizePhone(input.phone);
  const cid = newId();
  const { error: cErr } = await sb().from(tables.Client).insert({
    id: cid,
    displayName,
    source: "Bookings",
    notes: null,
    companyName: null,
    tags: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (cErr) throw cErr;

  if (normalizedPhone) {
    const { error: pErr } = await sb().from(tables.ContactPoint).insert({
      id: newId(),
      clientId: cid,
      kind: "PHONE",
      value: (input.phone ?? "").trim() || normalizedPhone,
      normalizedValue: normalizedPhone,
      isPrimary: true,
      createdAt: nowIso(),
    });
    if (pErr) throw pErr;
  }

  return cid;
}

/**
 * Case-insensitive match against this client's vehicles returns the existing id; otherwise inserts a new row.
 * Whitespace-only or very short labels yield undefined (no vehicle).
 */
export async function resolveOrCreateVehicleForClient(
  clientId: string,
  labelRaw: string | null | undefined,
): Promise<string | undefined> {
  const trimmed = (labelRaw ?? "").trim();
  if (trimmed.length < 2) return undefined;

  const { data: rows, error } = await sb().from(tables.Vehicle).select("id,label").eq("clientId", clientId);
  if (error) throw error;
  const lower = trimmed.toLowerCase();
  for (const v of rows ?? []) {
    if (String(v.label).trim().toLowerCase() === lower) {
      return v.id as string;
    }
  }

  const parsed = parseVehicleLabel(trimmed);
  const vid = newId();
  const { error: vErr } = await sb().from(tables.Vehicle).insert({
    id: vid,
    clientId,
    label: parsed.label,
    year: parsed.year,
    make: parsed.make,
    model: parsed.model,
    trim: null,
    notes: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (vErr) throw vErr;
  return vid;
}

export async function getImportsOverview(): Promise<ImportOverviewBatch[]> {
  const { data: batches, error } = await sb()
    .from(tables.ImportBatch)
    .select("*")
    .order("createdAt", { ascending: false });
  if (error) throw error;
  const list = batches ?? [];
  if (!list.length) return [];

  const batchIds = list.map((b) => b.id as string);
  const userIds = [...new Set(list.map((b) => b.uploadedById as string))];
  const { data: rows } = await sb()
    .from(tables.ImportRow)
    .select("*")
    .in("batchId", batchIds)
    .order("rowNumber", { ascending: true });
  const userMap = await fetchUsersByIds(userIds);

  const rowsByBatch = new Map<string, NonNullable<typeof rows>>();
  for (const r of rows ?? []) {
    const bid = r.batchId as string;
    if (!rowsByBatch.has(bid)) rowsByBatch.set(bid, []);
    rowsByBatch.get(bid)!.push(r);
  }

  return list.map((b) => ({
    ...b,
    createdAt: toDate(b.createdAt as string),
    uploadedBy: userMap.get(b.uploadedById as string)!,
    rows: rowsByBatch.get(b.id as string) ?? [],
  })) as ImportOverviewBatch[];
}

export async function getReportsOverview() {
  const [{ data: clients }, { data: callLogs }, { data: logsForDemand }, { data: users }, productLabels] =
    await Promise.all([
      sb().from(tables.Client).select("source"),
      sb().from(tables.CallLog).select("userId,outcomeCode"),
      sb().from(tables.CallLog).select("product,outcomeCode,productQuoteLines"),
      sb().from(tables.User).select("*"),
      getProductServiceLabelMap(),
    ]);

  const sourceMap = new Map<string | null, number>();
  for (const c of clients ?? []) {
    const s = (c.source as string | null) ?? null;
    sourceMap.set(s, (sourceMap.get(s) ?? 0) + 1);
  }
  const bySource = [...sourceMap.entries()].map(([source, _count]) => ({ source, _count }));

  const outcomeMap = new Map<string, number>();
  for (const cl of callLogs ?? []) {
    const code = cl.outcomeCode as string;
    outcomeMap.set(code, (outcomeMap.get(code) ?? 0) + 1);
  }
  const byOutcome = [...outcomeMap.entries()].map(([outcomeCode, _count]) => ({ outcomeCode, _count }));

  const staffMap = new Map<string, number>();
  for (const cl of callLogs ?? []) {
    const uid = cl.userId as string;
    staffMap.set(uid, (staffMap.get(uid) ?? 0) + 1);
  }
  const staffLookup = new Map((users ?? []).map((u) => [u.id, u]));
  const staffActivity = [...staffMap.entries()].map(([userId, _count]) => ({
    userId,
    _count,
    user: staffLookup.get(userId),
  }));

  const productMap = new Map<string, number>();
  for (const row of logsForDemand ?? []) {
    const outcome = row.outcomeCode as string;
    const multi = parseStoredProductQuoteLinesDb(row.productQuoteLines);
    const codes: string[] = [];
    if (multi?.length) {
      for (const item of multi) {
        const c = item.product.trim();
        codes.push(c && c.length > 0 ? c : "GENERAL");
      }
    } else {
      const raw = (row.product as string | null)?.trim();
      codes.push(raw && raw.length > 0 ? raw : "GENERAL");
    }
    for (const code of codes) {
      const k = `${code}|||${outcome}`;
      productMap.set(k, (productMap.get(k) ?? 0) + 1);
    }
  }
  const productInterest = [...productMap.entries()]
    .map(([k, _count]) => {
      const [code, outcomeCode] = k.split("|||");
      const productLabel = productLabels.get(code) ?? code;
      return { productCode: code, productLabel, outcomeCode, _count };
    })
    .sort((a, b) => b._count - a._count || a.productLabel.localeCompare(b.productLabel));

  return {
    bySource,
    byOutcome,
    staffActivity,
    productInterest,
  };
}

export async function addPaymentEvent(input: z.infer<typeof paymentEventCreateSchema>, userId: string): Promise<void> {
  const data = paymentEventCreateSchema.parse(input);
  const receivedAt = new Date(data.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) {
    throw new Error("Invalid received date.");
  }

  let appointmentId: string | null = data.appointmentId?.trim() ? data.appointmentId.trim() : null;
  if (appointmentId) {
    const { data: apt, error: aErr } = await sb()
      .from(tables.Appointment)
      .select("clientId")
      .eq("id", appointmentId)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!apt || (apt.clientId as string) !== data.clientId) {
      throw new Error("That booking does not belong to this client.");
    }
  }

  let callLogId: string | null = data.callLogId?.trim() ? data.callLogId.trim() : null;
  if (callLogId) {
    const { data: cl, error: cErr } = await sb()
      .from(tables.CallLog)
      .select("clientId")
      .eq("id", callLogId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!cl || (cl.clientId as string) !== data.clientId) {
      throw new Error("That call does not belong to this client.");
    }
  }

  const pid = newId();
  const { error } = await sb().from(tables.PaymentEvent).insert({
    id: pid,
    clientId: data.clientId,
    appointmentId,
    callLogId,
    kind: data.kind,
    amountCents: data.amountCents,
    receivedAt: receivedAt.toISOString(),
    method: data.method,
    reference: data.reference?.trim() ? data.reference.trim() : null,
    notes: data.notes?.trim() ? data.notes.trim() : null,
    recordedById: userId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (error) throw error;
}

type PaymentAppointmentSummary = { id: string; title: string; startAt: string };

async function appointmentSummaryMapByIds(appointmentIds: string[]): Promise<Map<string, PaymentAppointmentSummary>> {
  const ids = [...new Set(appointmentIds.filter(Boolean))];
  const map = new Map<string, PaymentAppointmentSummary>();
  if (!ids.length) return map;
  const { data: apts, error } = await sb()
    .from(tables.Appointment)
    .select("id, title, startAt")
    .in("id", ids);
  if (error) throw error;
  for (const a of apts ?? []) {
    map.set(a.id as string, {
      id: a.id as string,
      title: String(a.title ?? ""),
      startAt: a.startAt as string,
    });
  }
  return map;
}

async function buildAppointmentSummaryMapForClient(
  clientId: string,
  appointmentIds: string[],
): Promise<Map<string, PaymentAppointmentSummary>> {
  const map = new Map<string, PaymentAppointmentSummary>();
  const ids = [...new Set(appointmentIds.filter(Boolean))];
  if (!ids.length) return map;
  const { data: apts, error } = await sb()
    .from(tables.Appointment)
    .select("id, title, startAt")
    .in("id", ids)
    .eq("clientId", clientId);
  if (error) throw error;
  for (const a of apts ?? []) {
    map.set(a.id as string, {
      id: a.id as string,
      title: String(a.title ?? ""),
      startAt: a.startAt as string,
    });
  }
  return map;
}

async function hydratePaymentEvents(
  rows: Record<string, unknown>[],
  appointmentById: Map<string, PaymentAppointmentSummary> | null,
): Promise<PaymentEventView[]> {
  const userIds = [...new Set(rows.map((r) => r.recordedById as string))];
  const userMap = await fetchUsersByIds(userIds);
  return rows.map((r) => {
    const appointmentId = (r.appointmentId as string | null) ?? null;
    const apt = appointmentId && appointmentById?.get(appointmentId);
    const linkedBooking =
      appointmentId && apt
        ? { id: apt.id, title: apt.title, startAt: toDate(apt.startAt) }
        : null;
    return {
      id: r.id as string,
      clientId: r.clientId as string,
      appointmentId,
      callLogId: (r.callLogId as string | null) ?? null,
      kind: r.kind as PaymentEventView["kind"],
      amountCents: Number(r.amountCents),
      receivedAt: toDate(r.receivedAt as string),
      method: r.method as PaymentEventView["method"],
      reference: (r.reference as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      recordedById: r.recordedById as string,
      recordedByName: userMap.get(r.recordedById as string)?.name ?? "Unknown",
      linkedBooking,
    };
  });
}

export async function listPaymentEventsForClient(clientId: string): Promise<PaymentEventView[]> {
  const { data: rows, error } = await sb()
    .from(tables.PaymentEvent)
    .select("*")
    .eq("clientId", clientId)
    .order("receivedAt", { ascending: false });
  if (error) throw error;
  const list = (rows ?? []) as Record<string, unknown>[];
  const aptIds = list.map((r) => r.appointmentId as string | null).filter(Boolean) as string[];
  const aptMap = await buildAppointmentSummaryMapForClient(clientId, aptIds);
  return hydratePaymentEvents(list, aptMap);
}

export async function listPaymentEventsForAppointment(appointmentId: string): Promise<PaymentEventView[]> {
  const { data: rows, error } = await sb()
    .from(tables.PaymentEvent)
    .select("*")
    .eq("appointmentId", appointmentId)
    .order("receivedAt", { ascending: false });
  if (error) throw error;
  const list = (rows ?? []) as Record<string, unknown>[];
  const { data: apt, error: aptErr } = await sb()
    .from(tables.Appointment)
    .select("id, clientId, title, startAt")
    .eq("id", appointmentId)
    .maybeSingle();
  if (aptErr) throw aptErr;
  const aptMap = new Map<string, PaymentAppointmentSummary>();
  if (apt) {
    aptMap.set(apt.id as string, {
      id: apt.id as string,
      title: String(apt.title ?? ""),
      startAt: apt.startAt as string,
    });
  }
  return hydratePaymentEvents(list, aptMap);
}

export async function listPaymentEventsForExport(range?: { from: Date; to: Date }): Promise<PaymentEventView[]> {
  let q = sb().from(tables.PaymentEvent).select("*").order("receivedAt", { ascending: true });
  if (range) {
    q = q.gte("receivedAt", range.from.toISOString()).lte("receivedAt", range.to.toISOString());
  }
  const { data: rows, error } = await q;
  if (error) throw error;
  const list = (rows ?? []) as Record<string, unknown>[];
  const aptIds = list.map((r) => r.appointmentId as string | null).filter(Boolean) as string[];
  const aptMap = await appointmentSummaryMapByIds(aptIds);
  return hydratePaymentEvents(list, aptMap);
}

async function assertPaymentEventAppointmentAndCallBelongToClient(
  clientId: string,
  appointmentId: string | null,
  callLogId: string | null,
): Promise<void> {
  if (appointmentId) {
    const { data: apt, error: aErr } = await sb()
      .from(tables.Appointment)
      .select("clientId")
      .eq("id", appointmentId)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!apt || (apt.clientId as string) !== clientId) {
      throw new Error("That booking does not belong to this client.");
    }
  }
  if (callLogId) {
    const { data: cl, error: cErr } = await sb()
      .from(tables.CallLog)
      .select("clientId")
      .eq("id", callLogId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!cl || (cl.clientId as string) !== clientId) {
      throw new Error("That call does not belong to this client.");
    }
  }
}

export async function updatePaymentEvent(input: z.infer<typeof paymentEventUpdateSchema>, userId: string): Promise<void> {
  const data = paymentEventUpdateSchema.parse(input);
  const receivedAt = new Date(data.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) {
    throw new Error("Invalid received date.");
  }

  const { data: existing, error: exErr } = await sb()
    .from(tables.PaymentEvent)
    .select("id, clientId")
    .eq("id", data.paymentEventId)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!existing) {
    throw new Error("Payment entry not found.");
  }
  if ((existing.clientId as string) !== data.clientId) {
    throw new Error("Payment entry does not belong to this client.");
  }

  let appointmentId: string | null = data.appointmentId?.trim() ? data.appointmentId.trim() : null;
  let callLogId: string | null = data.callLogId?.trim() ? data.callLogId.trim() : null;
  await assertPaymentEventAppointmentAndCallBelongToClient(data.clientId, appointmentId, callLogId);

  const { error } = await sb()
    .from(tables.PaymentEvent)
    .update({
      appointmentId,
      callLogId,
      kind: data.kind,
      amountCents: data.amountCents,
      receivedAt: receivedAt.toISOString(),
      method: data.method,
      reference: data.reference?.trim() ? data.reference.trim() : null,
      notes: data.notes?.trim() ? data.notes.trim() : null,
      updatedAt: nowIso(),
    })
    .eq("id", data.paymentEventId);
  if (error) throw error;
  void userId;
}

export type DeletePaymentEventResult = {
  clientId: string;
  appointmentId: string | null;
};

export async function deletePaymentEvent(paymentEventId: string): Promise<DeletePaymentEventResult> {
  const { data: existing, error: exErr } = await sb()
    .from(tables.PaymentEvent)
    .select("id, clientId, appointmentId")
    .eq("id", paymentEventId)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!existing) {
    throw new Error("Payment entry not found.");
  }
  const { error } = await sb().from(tables.PaymentEvent).delete().eq("id", paymentEventId);
  if (error) throw error;
  return {
    clientId: existing.clientId as string,
    appointmentId: (existing.appointmentId as string | null) ?? null,
  };
}

export type BookingCallLinkExportRow = {
  appointmentId: string;
  clientId: string;
  clientDisplayName: string;
  title: string;
  startAtIso: string;
  callLogId: string | null;
  callHappenedAtIso: string | null;
  callSummary: string | null;
};

export async function listBookingCallLinkExportRows(
  range?: { from: Date; to: Date },
): Promise<BookingCallLinkExportRow[]> {
  let q = sb()
    .from(tables.Appointment)
    .select("id, clientId, title, startAt, callLogId")
    .order("startAt", { ascending: true });
  if (range) {
    q = q.gte("startAt", range.from.toISOString()).lte("startAt", range.to.toISOString());
  }
  const { data: apts, error: aErr } = await q;
  if (aErr) throw aErr;
  const list = apts ?? [];
  const callIds = [...new Set(list.map((a) => a.callLogId as string | null).filter(Boolean) as string[])];
  const callMap = new Map<string, { happenedAt: string; summary: string }>();
  if (callIds.length) {
    const { data: calls, error: cErr } = await sb()
      .from(tables.CallLog)
      .select("id, happenedAt, summary")
      .in("id", callIds);
    if (cErr) throw cErr;
    for (const c of calls ?? []) {
      callMap.set(c.id as string, {
        happenedAt: c.happenedAt as string,
        summary: String((c.summary as string) ?? ""),
      });
    }
  }
  const clientIds = [...new Set(list.map((a) => a.clientId as string))];
  const clientMap = await fetchClientsByIds(clientIds);
  return list.map((a) => {
    const cid = a.callLogId as string | null;
    const call = cid ? callMap.get(cid) : undefined;
    return {
      appointmentId: a.id as string,
      clientId: a.clientId as string,
      clientDisplayName: clientMap.get(a.clientId as string)?.displayName ?? "",
      title: a.title as string,
      startAtIso: a.startAt as string,
      callLogId: cid,
      callHappenedAtIso: call?.happenedAt ?? null,
      callSummary: call?.summary ?? null,
    };
  });
}

export async function getWorkspaceContext() {
  const [{ data: userOptions }, { data: clientRows }] = await Promise.all([
    sb().from(tables.User).select("*").order("name", { ascending: true }),
    sb().from(tables.Client).select("*").order("displayName", { ascending: true }),
  ]);

  const clients = clientRows ?? [];
  const ids = clients.map((c) => c.id as string);
  let vehicles: { clientId: string }[] = [];
  if (ids.length) {
    const { data: v } = await sb().from(tables.Vehicle).select("*").in("clientId", ids);
    vehicles = v ?? [];
  }
  const vehByClient = new Map<string, NonNullable<typeof vehicles>>();
  for (const v of vehicles) {
    const cid = v.clientId as string;
    if (!vehByClient.has(cid)) vehByClient.set(cid, []);
    vehByClient.get(cid)!.push(v);
  }

  return {
    userOptions: userOptions ?? [],
    clientOptions: clients.map((c) => ({
      ...c,
      createdAt: toDate(c.createdAt as string),
      updatedAt: toDate(c.updatedAt as string),
      vehicles: vehByClient.get(c.id as string) ?? [],
    })),
  };
}

export async function getCallLogPageData() {
  return getWorkspaceContext();
}

const MIN_PHONE_DIGITS_FOR_LOOKUP = 7;

export type { ClientPhoneMatch } from "@/lib/crm-types";

export type ClientCallLogPrefill = {
  displayName: string;
  vehicleText: string;
  source: string;
};

export type SelectClient = {
  id: string;
  displayName: string;
  companyName: string | null;
  source: string | null;
  tags: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  vehicles: Array<{ id: string; label: string; clientId: string }>;
};

export type ClientListRow = {
  id: string;
  displayName: string;
  companyName?: string | null;
  source: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  contactPoints: Array<{ id?: string; kind: string; value: string; isPrimary: boolean }>;
  vehicles: Array<{ label: string }>;
  opportunities: Array<{
    product: string;
    productDisplay: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  callLogs: Array<{ happenedAt: Date; summary: string; telephonyResult?: string | null }>;
  /** True when the latest call log (by `happenedAt`) has a stored telephony recording URI. */
  latestCallHasRecording: boolean;
  /** RingCentral/carrier disposition on the latest call when known (e.g. Voicemail). */
  latestTelephonyResult: string | null;
  /** Latest call outcome label (matches client card); falls back if there are no calls yet. */
  openStatusLabel: string;
  /** Latest of: most recent call `happenedAt`, newest opportunity update, or booking update; else client `updatedAt`. */
  lastActivityAt: Date;
};

export type ClientDetailView = {
  id: string;
  displayName: string;
  companyName: string | null;
  source: string | null;
  tags: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  contactPoints: Array<{ id: string; kind: string; value: string; isPrimary: boolean }>;
  vehicles: Array<{ label: string }>;
  callLogs: CallLogWithRelations[];
  opportunities: Array<{
    id: string;
    product: string;
    productDisplay: string;
    status: string;
    estimateText: string | null;
    summary: string | null;
    source: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  appointments: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    startAt: Date;
    endAt: Date;
    resourceKey: string | null;
    notes: string | null;
    vehicleLabel: string | null;
    depositText: string | null;
    callLogId: string | null;
  }>;
};

export type ImportOverviewBatch = {
  id: string;
  uploadedById: string;
  fileName: string;
  rowCount: number;
  importedCount: number;
  reviewCount: number;
  status: string;
  originalCsvText: string;
  createdAt: Date;
  uploadedBy: { id: string; name: string; email: string; role: string };
  rows: Array<{
    id: string;
    batchId: string;
    rowNumber: number;
    status: string;
    warning: string | null;
    rawJson: string;
    normalizedPhone: string | null;
  }>;
};

export async function getClientCallLogPrefill(clientId: string): Promise<ClientCallLogPrefill | null> {
  const { data: client, error } = await sb().from(tables.Client).select("displayName,source").eq("id", clientId).maybeSingle();
  if (error) throw error;
  if (!client) return null;

  const { data: veh } = await sb()
    .from(tables.Vehicle)
    .select("label")
    .eq("clientId", clientId)
    .order("createdAt", { ascending: true });

  const vehicleText = (veh ?? [])
    .map((v) => v.label)
    .filter(Boolean)
    .join(" · ");

  const opts = await getLeadSourceOptions(false);
  const raw = String((client.source as string | null) ?? "").trim();
  let sourceCode = "";
  if (raw) {
    if (opts.some((o) => String(o.code) === raw)) {
      sourceCode = raw;
    } else {
      const hit = opts.find((o) => String(o.label).trim().toLowerCase() === raw.toLowerCase());
      sourceCode = hit ? String(hit.code) : "";
    }
  }

  return {
    displayName: client.displayName as string,
    vehicleText,
    source: sourceCode,
  };
}

export async function findClientsByNormalizedPhone(normalizedDigits: string): Promise<ClientPhoneMatch[]> {
  if (!normalizedDigits || normalizedDigits.length < MIN_PHONE_DIGITS_FOR_LOOKUP) {
    return [];
  }

  const { data: rows, error } = await sb()
    .from(tables.ContactPoint)
    .select("clientId")
    .eq("kind", "PHONE")
    .eq("normalizedValue", normalizedDigits)
    .order("createdAt", { ascending: true });
  if (error) throw error;

  const seen = new Set<string>();
  const orderedIds: string[] = [];
  for (const row of rows ?? []) {
    const cid = row.clientId as string;
    if (seen.has(cid)) continue;
    seen.add(cid);
    orderedIds.push(cid);
  }

  const clientMap = await fetchClientsByIds(orderedIds);
  return orderedIds.map((id) => {
    const c = clientMap.get(id)!;
    return { id: c.id, displayName: c.displayName };
  });
}

/** True when Call history should not offer “Open log” again (opened once, or RingCentral stub already completed). */
export function isCallHistoryOpenLogDisabled(row: {
  openedFromCallHistoryAt: Date | string | null | undefined;
  telephonyDraft: boolean;
  summary: string;
  ringCentralCallLogId: string | null | undefined;
}): boolean {
  if (row.openedFromCallHistoryAt != null && String(row.openedFromCallHistoryAt).trim() !== "") {
    return true;
  }
  const rc = Boolean(String(row.ringCentralCallLogId ?? "").trim());
  if (rc) {
    if (!row.telephonyDraft) return true;
    return row.summary.trim() !== TELEPHONY_CALL_SUMMARY_PLACEHOLDER;
  }
  return false;
}

export type InboundCallHistoryRow = {
  id: string;
  clientId: string;
  clientDisplayName: string;
  contactPhone: string | null;
  contactName: string | null;
  happenedAt: Date;
  telephonyDraft: boolean;
  summary: string;
  openedFromCallHistoryAt: Date | null;
  ringCentralCallLogId: string | null;
};

const INBOUND_CALL_HISTORY_LIMIT = 200;

export async function listInboundCallHistory(): Promise<InboundCallHistoryRow[]> {
  const { data: rows, error } = await sb()
    .from(tables.CallLog)
    .select(
      "id,clientId,contactPhone,contactName,happenedAt,telephonyDraft,summary,openedFromCallHistoryAt,ringCentralCallLogId",
    )
    .eq("direction", "INBOUND")
    .order("happenedAt", { ascending: false })
    .order("id", { ascending: false })
    .limit(INBOUND_CALL_HISTORY_LIMIT);
  if (error) throw error;
  const list = rows ?? [];
  if (!list.length) return [];
  const clientMap = await fetchClientsByIds(list.map((r) => r.clientId as string));
  return list.map((r) => {
    const c = clientMap.get(r.clientId as string);
    return {
      id: r.id as string,
      clientId: r.clientId as string,
      clientDisplayName: c?.displayName ?? "Unknown client",
      contactPhone: (r.contactPhone as string | null) ?? null,
      contactName: (r.contactName as string | null) ?? null,
      happenedAt: toDate(r.happenedAt as string),
      telephonyDraft: Boolean(r.telephonyDraft),
      summary: String(r.summary ?? ""),
      openedFromCallHistoryAt: r.openedFromCallHistoryAt
        ? toDate(r.openedFromCallHistoryAt as string)
        : null,
      ringCentralCallLogId: (r.ringCentralCallLogId as string | null) ?? null,
    };
  });
}

/** Marks the call as opened from Call history; idempotent if already marked. Returns client id for redirect. */
export async function markCallLogOpenedFromCallHistory(callLogId: string): Promise<{ clientId: string }> {
  const { data: row, error } = await sb()
    .from(tables.CallLog)
    .select(
      "id,clientId,direction,openedFromCallHistoryAt,telephonyDraft,summary,ringCentralCallLogId",
    )
    .eq("id", callLogId)
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    throw new UserInputError("Call not found.");
  }
  if (String(row.direction) !== "INBOUND") {
    throw new UserInputError("Only inbound calls appear in call history.");
  }
  const clientId = row.clientId as string;
  if (row.openedFromCallHistoryAt) {
    return { clientId };
  }
  if (
    isCallHistoryOpenLogDisabled({
      openedFromCallHistoryAt: null,
      telephonyDraft: Boolean(row.telephonyDraft),
      summary: String(row.summary ?? ""),
      ringCentralCallLogId: (row.ringCentralCallLogId as string | null) ?? null,
    })
  ) {
    throw new UserInputError("This call can’t be opened from call history anymore.");
  }
  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb()
    .from(tables.CallLog)
    .update({ openedFromCallHistoryAt: nowIso })
    .eq("id", callLogId);
  if (upErr) throw upErr;
  return { clientId };
}

/**
 * When the user opens the log from the live dock, mirror “Open log” from call history so the table
 * does not keep offering a second entry point for the same RingCentral stub.
 */
export async function markInboundTelephonyStubOpenedFromLiveDock(
  phoneDigitsRaw: string,
): Promise<{ marked: boolean; clientId: string | null }> {
  let d = String(phoneDigitsRaw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length < 3) {
    return { marked: false, clientId: null };
  }

  const { data: rows, error } = await sb()
    .from(tables.CallLog)
    .select("id,clientId,contactPhone,openedFromCallHistoryAt")
    .eq("direction", "INBOUND")
    .eq("telephonyDraft", true)
    .eq("summary", TELEPHONY_CALL_SUMMARY_PLACEHOLDER)
    .is("openedFromCallHistoryAt", null)
    .order("happenedAt", { ascending: false })
    .limit(50);
  if (error) throw error;

  const list = rows ?? [];
  const norm = (raw: string) => {
    let x = raw.replace(/\D/g, "");
    if (x.length === 11 && x.startsWith("1")) x = x.slice(1);
    return x;
  };
  const target = norm(d);
  const match = list.find((r) => norm(String((r.contactPhone as string | null) ?? "")) === target);

  if (!match) {
    return { marked: false, clientId: null };
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb()
    .from(tables.CallLog)
    .update({ openedFromCallHistoryAt: nowIso })
    .eq("id", match.id as string);
  if (upErr) throw upErr;
  return { marked: true, clientId: match.clientId as string };
}

/** Call result for telephony-synced logs that do not need a callback (answered / connected). */
const TELEPHONY_IMPORT_OUTCOME_CODE = "ARCHIVED";

const TELEPHONY_CALLBACK_OUTCOME_CODE = "CALLBACK_NEEDED";

/** Collapse multiple missed/voicemail RC rows for the same client+phone inside this window to one open task. */
const TELEPHONY_CALLBACK_DEDUPE_WINDOW_MINUTES = 30;

/** Parsed RingCentral account call-log row (voice) ready for CRM upsert. */
export type RingCentralImportedCall = {
  ringCentralCallLogId: string;
  direction: CallDirection;
  happenedAt: Date;
  /** `ContactPoint.normalizedValue` / lookup key (often 10-digit US). */
  phoneNormalized: string;
  /** Stored on `CallLog.contactPhone` when exactly 10 digits; otherwise null. */
  contactPhone10: string | null;
  contactName: string;
  recording?: { id: string; contentUri: string };
  metadata: Record<string, unknown>;
  /** Carrier disposition (e.g. Voicemail, Missed) when present on the call-log record. */
  telephonyResult: string | null;
  /** When true, Tasks queue prompts staff to call back (voicemail / missed, etc.). */
  telephonyCallbackPending: boolean;
  /** RC disposition clearly answered/connected — used to clear older callback stubs for the same client. */
  telephonyAnsweredConnected: boolean;
};

function sanitizeTelephonyContactName(raw: string | null | undefined): string {
  const letters = String(raw ?? "")
    .replace(/\d/g, "")
    .replace(/[^\p{L}\s'-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (letters.length >= 2) return letters.slice(0, 120);
  return "Caller";
}

function isOpenTelephonyCallbackStub(r: { outcomeCode: string | null; telephonyCallbackPending: boolean | null }) {
  return r.outcomeCode === TELEPHONY_CALLBACK_OUTCOME_CODE || Boolean(r.telephonyCallbackPending);
}

/** True when the stored label is not a missed/voicemail/no-answer style disposition. */
function telephonyResultLooksResolvedNotMissed(label: string | null): boolean {
  if (!label?.trim()) return false;
  const norm = label.toLowerCase();
  if (norm.includes("missed")) return false;
  if (norm.includes("voicemail") || norm.includes("voice mail")) return false;
  if (norm.includes("no answer") || norm.includes("noanswer")) return false;
  if (norm.includes("busy") && !norm.includes("connected")) return false;
  return true;
}

/**
 * Whether this RC-backed row represents a successful conversation (customer was reached).
 * Used to compare “latest” RingCentral log vs older callback-needed stubs.
 */
function callLogRecordImpliesSuccessfulConversation(r: {
  telephonyResult?: string | null;
  telephonyCallbackPending?: boolean | null;
  outcomeCode?: string | null;
}): boolean {
  if (Boolean(r.telephonyCallbackPending)) return false;
  if (telephonyResultLabelImpliesAnsweredConnected(r.telephonyResult ?? null)) return true;
  const oc = String(r.outcomeCode ?? "");
  if (oc === TELEPHONY_IMPORT_OUTCOME_CODE && telephonyResultLooksResolvedNotMissed(r.telephonyResult ?? null)) {
    return true;
  }
  return false;
}

/** Newest log matching this means older RingCentral callback stubs should be archived (manual book/complete or RC “spoke”). */
function callLogImpliesOlderRcStubsShouldArchive(r: {
  outcomeCode?: string | null;
  telephonyResult?: string | null;
  telephonyCallbackPending?: boolean | null;
}): boolean {
  const oc = String(r.outcomeCode ?? "");
  if (OUTCOMES_CLEARING_OLDER_RC_CALLBACK_BURST.has(oc)) return true;
  return callLogRecordImpliesSuccessfulConversation(r);
}

async function collectClientIdsForTelephonyReconciliation(
  row: RingCentralImportedCall,
  resolvedClientId: string,
  persistedClientId?: string,
): Promise<string[]> {
  const idSet = new Set<string>([resolvedClientId]);
  if (persistedClientId && persistedClientId !== resolvedClientId) {
    idSet.add(persistedClientId);
  }
  if (row.phoneNormalized.length >= MIN_PHONE_DIGITS_FOR_LOOKUP) {
    for (const m of await findClientsByNormalizedPhone(row.phoneNormalized)) {
      idSet.add(m.id);
    }
  }
  return [...idSet];
}

/**
 * If the **newest** qualifying call (BOOKED / COMPLETED / NO_SOLUTION, or RC answered / resolved disposition)
 * is newer than open RingCentral missed/voicemail stubs, archive those older stubs. Manual “booked” logs were
 * previously ignored because reconciliation only scanned RC rows.
 */
async function reconcileTelephonyCallbacksIfLatestCallAnswered(clientId: string): Promise<void> {
  const { data: rows, error } = await sb()
    .from(tables.CallLog)
    .select("id,happenedAt,telephonyResult,telephonyCallbackPending,outcomeCode,ringCentralCallLogId")
    .eq("clientId", clientId)
    .order("happenedAt", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  if (error) throw error;
  const list = rows ?? [];
  if (list.length === 0) return;

  let anchor: (typeof list)[number] | null = null;
  for (const r of list) {
    if (callLogImpliesOlderRcStubsShouldArchive(r)) {
      anchor = r;
      break;
    }
  }
  if (!anchor) return;

  const anchorMs = new Date(anchor.happenedAt as string).getTime();
  const anchorId = anchor.id as string;

  const ids = list
    .filter((r) => {
      const rid = r.id as string;
      if (rid === anchorId) return false;
      const t = new Date(r.happenedAt as string).getTime();
      const older = t < anchorMs || (t === anchorMs && rid !== anchorId);
      if (!older) return false;
      if (!String((r as { ringCentralCallLogId?: string | null }).ringCentralCallLogId ?? "").trim()) {
        return false;
      }
      return isOpenTelephonyCallbackStub({
        outcomeCode: r.outcomeCode as string,
        telephonyCallbackPending: r.telephonyCallbackPending as boolean,
      });
    })
    .map((r) => r.id as string);

  if (ids.length === 0) return;

  const { error: upErr } = await sb()
    .from(tables.CallLog)
    .update({
      outcomeCode: TELEPHONY_IMPORT_OUTCOME_CODE,
      telephonyCallbackPending: false,
    })
    .in("id", ids);
  if (upErr) throw upErr;
}

/** Archive open RC callback stubs in a time window so repeat missed/voicemail bursts create one task. */
async function archiveDuplicateTelephonyCallbacksInWindow(params: {
  clientId: string;
  contactPhone10: string | null;
  center: Date;
  /** Leave this row open (e.g. current RingCentral sync target after an update). */
  exceptCallLogId?: string;
}): Promise<void> {
  const w = TELEPHONY_CALLBACK_DEDUPE_WINDOW_MINUTES;
  const from = new Date(params.center.getTime() - w * 60_000).toISOString();
  const to = new Date(params.center.getTime() + w * 60_000).toISOString();
  const { data: rows, error } = await sb()
    .from(tables.CallLog)
    .select("id,contactPhone,outcomeCode,telephonyCallbackPending,ringCentralCallLogId")
    .eq("clientId", params.clientId)
    .not("ringCentralCallLogId", "is", null)
    .gte("happenedAt", from)
    .lte("happenedAt", to);
  if (error) throw error;
  const phoneNorm = params.contactPhone10 ? normalizePhone(params.contactPhone10) : null;
  const exceptId = params.exceptCallLogId?.trim() || null;
  const ids = (rows ?? [])
    .filter((r) => {
      if (exceptId && (r.id as string) === exceptId) return false;
      const open =
        r.outcomeCode === TELEPHONY_CALLBACK_OUTCOME_CODE || Boolean(r.telephonyCallbackPending);
      if (!open) return false;
      if (phoneNorm) {
        const rowPhone = normalizePhone(String(r.contactPhone ?? ""));
        if (rowPhone && rowPhone !== phoneNorm) return false;
      }
      return true;
    })
    .map((r) => r.id as string);
  if (ids.length === 0) return;
  const { error: upErr } = await sb()
    .from(tables.CallLog)
    .update({
      outcomeCode: TELEPHONY_IMPORT_OUTCOME_CODE,
      telephonyCallbackPending: false,
    })
    .in("id", ids);
  if (upErr) throw upErr;
}

/**
 * Idempotent on `ringCentralCallLogId`. Resolves client by phone (single match only);
 * otherwise creates a minimal client + primary phone `ContactPoint`.
 */
export async function upsertCallLogFromRingCentralImport(
  row: RingCentralImportedCall,
  integrationUserId: string,
): Promise<{ callLogId: string; clientId: string; created: boolean }> {
  if (!row.ringCentralCallLogId?.trim()) {
    throw new Error("RingCentral call log id is required.");
  }
  const { data: userRow, error: userErr } = await sb()
    .from(tables.User)
    .select("id")
    .eq("id", integrationUserId)
    .maybeSingle();
  if (userErr) throw userErr;
  if (!userRow) {
    throw new Error("RINGCENTRAL_INTEGRATION_USER_ID does not match a CRM user.");
  }

  await Promise.all([
    requireActiveOutcomeCode(TELEPHONY_IMPORT_OUTCOME_CODE),
    requireActiveOutcomeCode(TELEPHONY_CALLBACK_OUTCOME_CODE),
  ]);

  const { data: existing } = await sb()
    .from(tables.CallLog)
    .select("id,clientId,telephonyDraft,summary")
    .eq("ringCentralCallLogId", row.ringCentralCallLogId)
    .maybeSingle();

  let clientId: string;
  if (row.phoneNormalized.length >= MIN_PHONE_DIGITS_FOR_LOOKUP) {
    const matches = await findClientsByNormalizedPhone(row.phoneNormalized);
    if (matches.length === 1) {
      clientId = matches[0].id;
    } else {
      clientId = await createMinimalTelephonyClient(row.phoneNormalized, row.contactPhone10, row.contactName);
    }
  } else {
    clientId = await createMinimalTelephonyClient("", null, row.contactName);
  }

  await enrichTelephonyClientDisplayNameFromCallerId(clientId, row.contactName);

  if (!existing && row.telephonyCallbackPending) {
    await archiveDuplicateTelephonyCallbacksInWindow({
      clientId,
      contactPhone10: row.contactPhone10,
      center: row.happenedAt,
    });
  }

  const productQuoteLines = [{ product: "GENERAL", priceText: null as string | null }];
  const telephonyPayload = {
    telephonyRecordingId: row.recording?.id ?? null,
    telephonyRecordingContentUri: row.recording?.contentUri ?? null,
    telephonyMetadata: row.metadata,
    telephonyResult: row.telephonyResult,
    telephonyCallbackPending: row.telephonyCallbackPending,
  };

  if (existing) {
    const patch: Record<string, unknown> = {
      ...telephonyPayload,
      direction: row.direction,
      happenedAt: row.happenedAt.toISOString(),
      contactPhone: row.contactPhone10,
      contactName: row.contactName,
    };
    if (!existing.telephonyDraft) {
      patch.telephonyCallbackPending = false;
    }
    const summaryTrim = String((existing as { summary?: string | null }).summary ?? "").trim();
    const isPlaceholderSummary = summaryTrim === TELEPHONY_CALL_SUMMARY_PLACEHOLDER;
    if (Boolean(existing.telephonyDraft) || isPlaceholderSummary) {
      patch.outcomeCode = row.telephonyCallbackPending
        ? TELEPHONY_CALLBACK_OUTCOME_CODE
        : TELEPHONY_IMPORT_OUTCOME_CODE;
      patch.followUpAt = null;
    }
    const { error: uErr } = await sb().from(tables.CallLog).update(patch).eq("id", existing.id);
    if (uErr) throw uErr;
    const callLogId = existing.id;
    const persistedClientId = existing.clientId as string;
    if (row.telephonyCallbackPending) {
      await archiveDuplicateTelephonyCallbacksInWindow({
        clientId: persistedClientId,
        contactPhone10: row.contactPhone10,
        center: row.happenedAt,
        exceptCallLogId: callLogId as string,
      });
    }
    const reconcileIds = await collectClientIdsForTelephonyReconciliation(row, clientId, persistedClientId);
    for (const cid of reconcileIds) {
      await reconcileTelephonyCallbacksIfLatestCallAnswered(cid);
    }
    return { callLogId, clientId: persistedClientId, created: false };
  }

  const logId = newId();
  const { error: iErr } = await sb().from(tables.CallLog).insert({
    id: logId,
    clientId,
    userId: integrationUserId,
    direction: row.direction,
    happenedAt: row.happenedAt.toISOString(),
    outcomeCode: row.telephonyCallbackPending
      ? TELEPHONY_CALLBACK_OUTCOME_CODE
      : TELEPHONY_IMPORT_OUTCOME_CODE,
    summary: TELEPHONY_CALL_SUMMARY_PLACEHOLDER,
    contactPhone: row.contactPhone10,
    contactName: row.contactName,
    vehicleText: null,
    product: "GENERAL",
    priceText: null,
    productQuoteLines: productQuoteLines as unknown as Record<string, unknown>[],
    source: null,
    callbackNotes: null,
    internalNotes: null,
    followUpAt: null,
    createdAt: nowIso(),
    ringCentralCallLogId: row.ringCentralCallLogId,
    telephonyDraft: true,
    ...telephonyPayload,
  });
  if (iErr) throw iErr;
  const reconcileIds = await collectClientIdsForTelephonyReconciliation(row, clientId);
  for (const cid of reconcileIds) {
    await reconcileTelephonyCallbacksIfLatestCallAnswered(cid);
  }
  return { callLogId: logId, clientId, created: true };
}

/** New RingCentral stubs: use caller-ID name when present; otherwise "Caller". */
async function createMinimalTelephonyClient(
  phoneNormalized: string,
  contactPhone10: string | null,
  displayNameHint: string,
): Promise<string> {
  const hint = displayNameHint.trim();
  const displayName =
    hint.length >= 2 && hint.toLowerCase() !== "caller" ? hint.slice(0, 200) : "Caller";
  const cid = newId();
  const { error: cErr } = await sb().from(tables.Client).insert({
    id: cid,
    displayName,
    source: "RingCentral",
    notes: null,
    companyName: null,
    tags: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (cErr) throw cErr;
  if (phoneNormalized.length >= MIN_PHONE_DIGITS_FOR_LOOKUP) {
    const value = contactPhone10 ?? phoneNormalized;
    const { error: pErr } = await sb().from(tables.ContactPoint).insert({
      id: newId(),
      clientId: cid,
      kind: "PHONE",
      value,
      normalizedValue: phoneNormalized,
      isPrimary: true,
      createdAt: nowIso(),
    });
    if (pErr) throw pErr;
  }
  return cid;
}

/** If the client is still the generic RingCentral stub, replace displayName with caller-ID from the latest sync. */
async function enrichTelephonyClientDisplayNameFromCallerId(clientId: string, contactName: string): Promise<void> {
  const t = contactName.trim();
  if (t.length < 2 || t === "Caller") return;
  const { data: row, error: fErr } = await sb()
    .from(tables.Client)
    .select("id,displayName")
    .eq("id", clientId)
    .maybeSingle();
  if (fErr) throw fErr;
  if (!row) return;
  const current = String((row.displayName as string | null) ?? "").trim();
  if (current !== "Caller") return;
  const { error: uErr } = await sb()
    .from(tables.Client)
    .update({ displayName: t.slice(0, 200), updatedAt: nowIso() })
    .eq("id", clientId);
  if (uErr) throw uErr;
}

export { sanitizeTelephonyContactName };

/** Apply RingCentral async AI (speech-to-text) webhook payload to the matching call log. */
export async function applyRingCentralAiWebhookPayload(body: unknown): Promise<{ updated: boolean }> {
  const extracted = extractRingCentralAiWebhookFields(body);
  if (!extracted) return { updated: false };

  const { jobId, status, transcript, summary } = extracted;
  const success = status.toLowerCase() === "success";

  const { data: row, error: fErr } = await sb()
    .from(tables.CallLog)
    .select("id")
    .eq("telephonyAiJobId", jobId)
    .maybeSingle();
  if (fErr) throw fErr;
  if (!row) return { updated: false };

  const patch: Record<string, unknown> = {
    telephonyAiJobId: null,
  };
  if (success) {
    if (transcript != null) patch.telephonyTranscript = transcript;
    if (summary != null) patch.telephonyAiSummary = summary;
  }

  const { error: uErr } = await sb().from(tables.CallLog).update(patch).eq("id", row.id);
  if (uErr) throw uErr;
  return { updated: true };
}

function extractRingCentralAiWebhookFields(
  body: unknown,
): { jobId: string; status: string; transcript?: string; summary?: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const jobId = typeof o.jobId === "string" ? o.jobId.trim() : "";
  const status = typeof o.status === "string" ? o.status.trim() : "";
  if (!jobId) return null;
  const response = o.response;
  let transcript: string | undefined;
  let summary: string | undefined;
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const r = response as Record<string, unknown>;
    if (typeof r.transcript === "string") transcript = r.transcript;
    if (typeof r.summary === "string") summary = r.summary;
  }
  return { jobId, status, transcript, summary };
}

export async function setCallLogTelephonyAiJobId(callLogId: string, jobId: string): Promise<void> {
  const { error } = await sb().from(tables.CallLog).update({ telephonyAiJobId: jobId }).eq("id", callLogId);
  if (error) throw error;
}

export class AmbiguousPhoneMatchError extends Error {
  constructor(public readonly matches: ClientPhoneMatch[]) {
    super("Multiple customers share this phone number. Pick one or create a new record.");
    this.name = "AmbiguousPhoneMatchError";
  }
}

export async function getCallResultOptions(activeOnly = true) {
  let q = sb().from(tables.CallResultOption).select("*").order("sortOrder", { ascending: true });
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  const list = (data ?? []).slice().sort((a, b) => {
    const so = (a.sortOrder as number) - (b.sortOrder as number);
    if (so !== 0) return so;
    return String(a.label).localeCompare(String(b.label));
  });
  return list.map((r) => ({
    ...r,
    createdAt: toDate(r.createdAt as string),
  }));
}

export async function getBookingTypeOptions(activeOnly = true) {
  let q = sb().from(tables.BookingTypeOption).select("*").order("sortOrder", { ascending: true });
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  const list = (data ?? []).slice().sort((a, b) => {
    const so = (a.sortOrder as number) - (b.sortOrder as number);
    if (so !== 0) return so;
    return String(a.label).localeCompare(String(b.label));
  });
  return list.map((r) => ({
    ...r,
    createdAt: toDate(r.createdAt as string),
  }));
}

export async function requireActiveBookingTypeCode(code: string) {
  const { data, error } = await sb()
    .from(tables.BookingTypeOption)
    .select("code")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("That booking type is not available. Choose another or add it in Workspace → Booking types.");
  }
}

export async function createCustomBookingTypeOption(
  label: string,
  accentKey?: string | null,
  accentHex?: string | null,
) {
  const trimmed = label.trim();
  if (trimmed.length < 2) {
    throw new Error("Enter a label with at least 2 characters.");
  }
  const { data: maxRows, error: maxErr } = await sb()
    .from(tables.BookingTypeOption)
    .select("sortOrder")
    .order("sortOrder", { ascending: false })
    .limit(1);
  if (maxErr) throw maxErr;
  const sortOrder = ((maxRows?.[0]?.sortOrder as number) ?? 0) + 10;
  const code = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ak = normalizeStoredAccentKey(accentKey ?? undefined);
  const hex = normalizeStoredAccentHex(accentHex ?? null);
  const row = {
    code,
    label: trimmed,
    sortOrder,
    isBuiltIn: false,
    active: true,
    accentKey: ak,
    accentHex: hex,
    createdAt: nowIso(),
  };
  const { data, error } = await sb().from(tables.BookingTypeOption).insert(row).select("*").single();
  if (error) throw error;
  return { ...data, createdAt: toDate(data.createdAt as string) };
}

export async function updateBookingTypeOptionAccent(
  code: string,
  accentKey: string,
  accentHexRaw: string | null | undefined,
) {
  const ak = normalizeStoredAccentKey(accentKey);
  const trimmed = accentHexRaw == null ? "" : String(accentHexRaw).trim();
  const hex = trimmed === "" ? null : normalizeStoredAccentHex(trimmed);
  const { error } = await sb()
    .from(tables.BookingTypeOption)
    .update({ accentKey: ak, accentHex: hex })
    .eq("code", code);
  if (error) throw error;
}

export async function updateBookingTypeOptionLabel(code: string, label: string) {
  const trimmed = label.trim();
  if (trimmed.length < 2) {
    throw new Error("Enter a label with at least 2 characters.");
  }
  const { error } = await sb().from(tables.BookingTypeOption).update({ label: trimmed }).eq("code", code);
  if (error) throw error;
}

export async function setBookingTypeOptionActive(code: string, active: boolean) {
  const { error } = await sb().from(tables.BookingTypeOption).update({ active }).eq("code", code);
  if (error) throw error;
}

export async function removeCustomBookingTypeOption(code: string) {
  const { data: row, error: fErr } = await sb().from(tables.BookingTypeOption).select("*").eq("code", code).maybeSingle();
  if (fErr) throw fErr;
  if (!row) {
    throw new Error("Option not found.");
  }
  if (row.isBuiltIn) {
    throw new Error("Built-in booking types cannot be deleted.");
  }
  const { count, error: cErr } = await sb()
    .from(tables.Appointment)
    .select("*", { count: "exact", head: true })
    .eq("type", code);
  if (cErr) throw cErr;
  const inUse = (count ?? 0) > 0;
  if (inUse) {
    const { error } = await sb().from(tables.BookingTypeOption).update({ active: false }).eq("code", code);
    if (error) throw error;
    return "deactivated" as const;
  }
  const { error: dErr } = await sb().from(tables.BookingTypeOption).delete().eq("code", code);
  if (dErr) throw dErr;
  return "deleted" as const;
}

export async function getProductServiceOptions(activeOnly = true) {
  let q = sb().from(tables.ProductServiceOption).select("*").order("sortOrder", { ascending: true });
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  const list = (data ?? []).slice().sort((a, b) => {
    const so = (a.sortOrder as number) - (b.sortOrder as number);
    if (so !== 0) return so;
    return String(a.label).localeCompare(String(b.label));
  });
  return list.map((r) => ({
    ...r,
    createdAt: toDate(r.createdAt as string),
  }));
}

export async function getProductServiceLabelMap(): Promise<Map<string, string>> {
  const rows = await getProductServiceOptions(false);
  const m = new Map<string, string>();
  for (const r of rows) m.set(String(r.code), String(r.label));
  return m;
}

export async function createCustomProductServiceOption(label: string, matchTerms?: string | null) {
  const trimmed = label.trim();
  if (trimmed.length < 2) {
    throw new Error("Enter a label with at least 2 characters.");
  }
  const { data: maxRows, error: maxErr } = await sb()
    .from(tables.ProductServiceOption)
    .select("sortOrder")
    .order("sortOrder", { ascending: false })
    .limit(1);
  if (maxErr) throw maxErr;
  const sortOrder = ((maxRows?.[0]?.sortOrder as number) ?? 0) + 10;
  const code = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mtRaw = matchTerms?.trim() || trimmed.toLowerCase();
  const row = {
    code,
    label: trimmed,
    matchTerms: mtRaw.slice(0, 4000),
    sortOrder,
    isBuiltIn: false,
    active: true,
    createdAt: nowIso(),
  };
  const { data, error } = await sb().from(tables.ProductServiceOption).insert(row).select("*").single();
  if (error) throw error;
  return { ...data, createdAt: toDate(data.createdAt as string) };
}

export async function updateProductServiceOptionLabel(code: string, label: string) {
  const trimmed = label.trim();
  if (trimmed.length < 2) {
    throw new Error("Enter a label with at least 2 characters.");
  }
  const { error } = await sb().from(tables.ProductServiceOption).update({ label: trimmed }).eq("code", code);
  if (error) throw error;
}

export async function updateProductServiceOptionMatchTerms(code: string, matchTerms: string) {
  const trimmed = matchTerms.trim().slice(0, 4000);
  const { error } = await sb().from(tables.ProductServiceOption).update({ matchTerms: trimmed }).eq("code", code);
  if (error) throw error;
}

export async function setProductServiceOptionActive(code: string, active: boolean) {
  if (code === "GENERAL" && !active) {
    throw new Error("General cannot be deactivated.");
  }
  const { error } = await sb().from(tables.ProductServiceOption).update({ active }).eq("code", code);
  if (error) throw error;
}

export async function removeCustomProductServiceOption(code: string) {
  if (code === "GENERAL") {
    throw new Error("The built-in General option cannot be deleted.");
  }
  const { data: row, error: fErr } = await sb()
    .from(tables.ProductServiceOption)
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (fErr) throw fErr;
  if (!row) {
    throw new Error("Option not found.");
  }
  if (row.isBuiltIn) {
    throw new Error("Built-in services cannot be deleted.");
  }
  const [{ count: clCount, error: clErr }, { count: oppCount, error: oppErr }] = await Promise.all([
    sb().from(tables.CallLog).select("*", { count: "exact", head: true }).eq("product", code),
    sb().from(tables.Opportunity).select("*", { count: "exact", head: true }).eq("product", code),
  ]);
  if (clErr) throw clErr;
  if (oppErr) throw oppErr;
  const inUse = (clCount ?? 0) > 0 || (oppCount ?? 0) > 0;
  if (inUse) {
    const { error } = await sb().from(tables.ProductServiceOption).update({ active: false }).eq("code", code);
    if (error) throw error;
    return "deactivated" as const;
  }
  const { error: dErr } = await sb().from(tables.ProductServiceOption).delete().eq("code", code);
  if (dErr) throw dErr;
  return "deleted" as const;
}

async function resolveStoredProductCodeForCallLog(input: {
  product?: string | null;
  summary: string;
  vehicleText?: string | null;
  callbackNotes?: string | null;
  internalNotes?: string | null;
}): Promise<string> {
  const rows = await getProductServiceOptions(true);
  const options: ProductServiceResolveRow[] = rows.map((r) => ({
    code: String(r.code),
    label: String(r.label),
    matchTerms: String((r as { matchTerms?: string }).matchTerms ?? ""),
    active: Boolean(r.active),
  }));
  const haystack = [input.summary, input.vehicleText, input.callbackNotes, input.internalNotes, input.product]
    .filter(Boolean)
    .join(" | ");
  return resolveProductServiceCodeFromHaystack(input.product ?? "", haystack, options);
}

async function resolveCallLogProductQuoteLines(
  rawLines: Array<{ product: string; priceText: string }>,
  ctx: {
    summary: string;
    vehicleText?: string | null;
    callbackNotes?: string | null;
    internalNotes?: string | null;
  },
): Promise<Array<{ product: string; priceText: string | null }>> {
  const out: Array<{ product: string; priceText: string | null }> = [];
  for (const line of rawLines) {
    const code = await resolveStoredProductCodeForCallLog({
      product: line.product,
      summary: ctx.summary,
      vehicleText: ctx.vehicleText,
      callbackNotes: ctx.callbackNotes,
      internalNotes: ctx.internalNotes,
    });
    const digits = priceDigitsForCallLog(line.priceText);
    out.push({ product: code, priceText: digits || null });
  }
  return out;
}

/** Clears follow-up when the call is effectively closed or handed off. */
const OUTCOME_CODES_CLEAR_FOLLOW_UP = new Set([
  "COMPLETED",
  "ARCHIVED",
  "BOOKED",
  "NO_SOLUTION",
  "SUPPORT",
]);

/** Still a “needs another touch” result — roll follow-up forward if one was set. */
const OUTCOME_CODES_BUMP_FOLLOW_UP = new Set(["CALLBACK_NEEDED", "FOLLOW_UP"]);

/**
 * When the result changes: clear follow-up for closed outcomes; bump +1 week between callback outcomes;
 * otherwise keep the previous follow-up time (e.g. QUOTE_SENT + scheduled callback).
 */
export function resolveFollowUpAfterOutcomeChange(
  newOutcomeCode: string,
  previousFollowUpAt: Date | null,
): Date | null {
  if (OUTCOME_CODES_CLEAR_FOLLOW_UP.has(newOutcomeCode)) {
    return null;
  }
  if (OUTCOME_CODES_BUMP_FOLLOW_UP.has(newOutcomeCode)) {
    if (previousFollowUpAt) {
      return addWeeks(previousFollowUpAt, 1);
    }
    return null;
  }
  return previousFollowUpAt;
}

export async function requireActiveOutcomeCode(code: string) {
  const { data, error } = await sb()
    .from(tables.CallResultOption)
    .select("code")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("That call result is not available. Choose another or add it in Workspace.");
  }
}

export async function quickUpdateCallLogOutcomeCode(callLogId: string, clientId: string, outcomeCode: string) {
  await requireActiveOutcomeCode(outcomeCode);
  const { data: existing, error: gErr } = await sb()
    .from(tables.CallLog)
    .select("id,followUpAt")
    .eq("id", callLogId)
    .eq("clientId", clientId)
    .maybeSingle();
  if (gErr) throw gErr;
  if (!existing) {
    throw new Error("Call log not found for this client.");
  }
  const prevFollow = existing.followUpAt ? toDate(existing.followUpAt as string) : null;
  const nextFollow = resolveFollowUpAfterOutcomeChange(outcomeCode, prevFollow);
  const { data, error } = await sb()
    .from(tables.CallLog)
    .update({
      outcomeCode,
      followUpAt: nextFollow ? nextFollow.toISOString() : null,
      telephonyDraft: false,
      telephonyCallbackPending: false,
    })
    .eq("id", callLogId)
    .eq("clientId", clientId)
    .select("id");
  if (error) throw error;
  if (!data?.length) {
    throw new Error("Call log not found for this client.");
  }

  await reconcileTelephonyCallbacksIfLatestCallAnswered(clientId);
}

export async function createCustomCallResultOption(
  label: string,
  accentKey?: string | null,
  accentHex?: string | null,
) {
  const trimmed = label.trim();
  if (trimmed.length < 2) {
    throw new Error("Enter a label with at least 2 characters.");
  }
  const { data: maxRows, error: maxErr } = await sb()
    .from(tables.CallResultOption)
    .select("sortOrder")
    .order("sortOrder", { ascending: false })
    .limit(1);
  if (maxErr) throw maxErr;
  const sortOrder = ((maxRows?.[0]?.sortOrder as number) ?? 0) + 10;
  const code = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ak = normalizeStoredAccentKey(accentKey ?? undefined);
  const hex = normalizeStoredAccentHex(accentHex ?? null);
  const row = {
    code,
    label: trimmed,
    sortOrder,
    isBuiltIn: false,
    active: true,
    accentKey: ak,
    accentHex: hex,
    createdAt: nowIso(),
  };
  const { data, error } = await sb().from(tables.CallResultOption).insert(row).select("*").single();
  if (error) throw error;
  return { ...data, createdAt: toDate(data.createdAt as string) };
}

export async function updateCallResultOptionAccent(
  code: string,
  accentKey: string,
  accentHexRaw: string | null | undefined,
) {
  const ak = normalizeStoredAccentKey(accentKey);
  const trimmed = accentHexRaw == null ? "" : String(accentHexRaw).trim();
  const hex = trimmed === "" ? null : normalizeStoredAccentHex(trimmed);
  const { error } = await sb()
    .from(tables.CallResultOption)
    .update({ accentKey: ak, accentHex: hex })
    .eq("code", code);
  if (error) throw error;
}

export async function updateCallResultOptionLabel(code: string, label: string) {
  const trimmed = label.trim();
  if (trimmed.length < 2) {
    throw new Error("Enter a label with at least 2 characters.");
  }
  const { error } = await sb().from(tables.CallResultOption).update({ label: trimmed }).eq("code", code);
  if (error) throw error;
}

export async function setCallResultOptionActive(code: string, active: boolean) {
  const { error } = await sb().from(tables.CallResultOption).update({ active }).eq("code", code);
  if (error) throw error;
}

export async function removeCustomCallResultOption(code: string) {
  const { data: row, error: fErr } = await sb().from(tables.CallResultOption).select("*").eq("code", code).maybeSingle();
  if (fErr) throw fErr;
  if (!row) {
    throw new Error("Option not found.");
  }
  if (row.isBuiltIn) {
    throw new Error("Built-in call results cannot be deleted.");
  }
  const { count, error: cErr } = await sb()
    .from(tables.CallLog)
    .select("*", { count: "exact", head: true })
    .eq("outcomeCode", code);
  if (cErr) throw cErr;
  const inUse = (count ?? 0) > 0;
  if (inUse) {
    const { error } = await sb().from(tables.CallResultOption).update({ active: false }).eq("code", code);
    if (error) throw error;
    return "deactivated" as const;
  }
  const { error: dErr } = await sb().from(tables.CallResultOption).delete().eq("code", code);
  if (dErr) throw dErr;
  return "deleted" as const;
}

export async function getClientDisplayName(clientId: string): Promise<string | null> {
  const { data, error } = await sb().from(tables.Client).select("displayName").eq("id", clientId).maybeSingle();
  if (error) throw error;
  const n = (data?.displayName as string | undefined)?.trim();
  return n && n.length > 0 ? n : null;
}

export async function getClientPrimaryPhoneValue(clientId: string): Promise<string | null> {
  const { data, error } = await sb()
    .from(tables.ContactPoint)
    .select("value,isPrimary")
    .eq("clientId", clientId)
    .eq("kind", "PHONE");
  if (error) throw error;
  const rows = data ?? [];
  const primary = rows.find((r) => r.isPrimary);
  const v = String((primary ?? rows[0])?.value ?? "").trim();
  return v.length > 0 ? v : null;
}

export async function getVehicleLabelForClient(vehicleId: string, clientId: string): Promise<string | null> {
  if (!vehicleId.trim()) return null;
  const { data, error } = await sb()
    .from(tables.Vehicle)
    .select("label")
    .eq("id", vehicleId.trim())
    .eq("clientId", clientId)
    .maybeSingle();
  if (error) throw error;
  const label = String((data?.label as string | undefined) ?? "").trim();
  return label.length > 0 ? label : null;
}

export async function addCallLog(
  input: z.infer<typeof callLogSchema>,
  userId: string,
): Promise<{ callLogId: string; clientId: string }> {
  const data = callLogSchema.parse(input);
  const phoneDigits = normalizeCallLogPhoneDigits(data.contactPhone ?? "");
  assertCallLogPhoneValid(phoneDigits);
  assertContactNameValid(data.contactName);
  const normalizedPhone = phoneDigits || null;
  const forceNew = data.forceNewClient === true;

  const sourceTrim = String(data.source ?? "").trim();
  if (sourceTrim) {
    await requireActiveLeadSourceCode(sourceTrim);
  }

  let clientId = forceNew ? "" : (data.clientId || "").trim();

  if (clientId) {
    const { data: exists } = await sb().from(tables.Client).select("id").eq("id", clientId).maybeSingle();
    if (!exists) clientId = "";
  }

  if (!clientId && !forceNew && normalizedPhone) {
    const matches = await findClientsByNormalizedPhone(normalizedPhone);
    if (matches.length === 1) {
      clientId = matches[0].id;
    } else if (matches.length > 1) {
      throw new AmbiguousPhoneMatchError(matches);
    }
  }

  if (!clientId) {
    const cid = newId();
    let clientSourceText = "Phone call";
    if (sourceTrim) {
      const { data: srcRow, error: srcErr } = await sb()
        .from(tables.LeadSourceOption)
        .select("label")
        .eq("code", sourceTrim)
        .maybeSingle();
      if (srcErr) {
        if (isMissingLeadSourceRelationError(srcErr)) {
          clientSourceText = leadSourceFallbackLabel(sourceTrim) ?? sourceTrim;
        } else {
          throw srcErr;
        }
      } else {
        clientSourceText = String((srcRow?.label as string | undefined) ?? sourceTrim);
      }
    }
    const { error: cErr } = await sb().from(tables.Client).insert({
      id: cid,
      displayName: data.contactName.trim(),
      source: clientSourceText,
      notes: data.internalNotes || null,
      companyName: null,
      tags: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    if (cErr) throw cErr;

    if (normalizedPhone) {
      const { error: pErr } = await sb().from(tables.ContactPoint).insert({
        id: newId(),
        clientId: cid,
        kind: "PHONE",
        value: phoneDigits,
        normalizedValue: normalizedPhone,
        isPrimary: true,
        createdAt: nowIso(),
      });
      if (pErr) throw pErr;
    }

    if (data.vehicleText) {
      const v = parseVehicleLabel(data.vehicleText);
      const { error: vErr } = await sb().from(tables.Vehicle).insert({
        id: newId(),
        clientId: cid,
        label: v.label,
        year: v.year,
        make: v.make,
        model: v.model,
        trim: null,
        notes: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      if (vErr) throw vErr;
    }

    clientId = cid;
  }

  await requireActiveOutcomeCode(data.outcomeCode);

  const ctx = {
    summary: data.summary,
    vehicleText: data.vehicleText,
    callbackNotes: data.callbackNotes,
    internalNotes: data.internalNotes,
  };

  let parsedLines = parseClientProductQuoteLinesJson(data.productQuoteLinesJson);
  if (!parsedLines.length) {
    parsedLines = [
      {
        product: String(data.product ?? ""),
        priceText: String(data.priceText ?? ""),
      },
    ].filter((r) => r.product.trim() || r.priceText.trim());
  }

  let resolvedLines: Array<{ product: string; priceText: string | null }>;
  if (parsedLines.length === 0) {
    const code = await resolveStoredProductCodeForCallLog({
      product: "",
      ...ctx,
    });
    resolvedLines = [{ product: code, priceText: null }];
  } else {
    resolvedLines = await resolveCallLogProductQuoteLines(parsedLines, ctx);
  }

  const primary = resolvedLines[0]!;

  const callLogPayload = {
    direction: data.direction,
    happenedAt: (data.happenedAt ? new Date(data.happenedAt) : new Date()).toISOString(),
    contactPhone: phoneDigits || null,
    contactName: data.contactName || null,
    vehicleText: data.vehicleText || null,
    product: primary.product,
    priceText: primary.priceText,
    productQuoteLines: resolvedLines as unknown as Record<string, unknown>[],
    callbackNotes: data.callbackNotes || null,
    source: sourceTrim || null,
    summary: data.summary,
    outcomeCode: data.outcomeCode,
    internalNotes: data.internalNotes || null,
    followUpAt: data.followUpAt ? new Date(data.followUpAt).toISOString() : null,
  };

  const trimmedLogId = (data.callLogId || "").trim();
  if (trimmedLogId) {
    const { data: existing } = await sb()
      .from(tables.CallLog)
      .select("id")
      .eq("id", trimmedLogId)
      .eq("clientId", clientId)
      .maybeSingle();
    if (existing) {
      const { error: uErr } = await sb().from(tables.CallLog).update(callLogPayload).eq("id", existing.id);
      if (uErr) throw uErr;
      await reconcileTelephonyCallbacksIfLatestCallAnswered(clientId);
      return { callLogId: existing.id, clientId };
    }
  }

  const logId = newId();
  const { error: lErr } = await sb().from(tables.CallLog).insert({
    id: logId,
    clientId,
    userId,
    ...callLogPayload,
    createdAt: nowIso(),
  });
  if (lErr) throw lErr;

  await reconcileTelephonyCallbacksIfLatestCallAnswered(clientId);
  return { callLogId: logId, clientId };
}

export const updateCallLogSchema = z.object({
  callLogId: z.string().min(1),
  clientId: z.string().min(1),
  happenedAt: z.string().min(1),
  contactPhone: z.string().optional(),
  contactName: z.string().min(1),
  vehicleText: z.string().optional(),
  product: z.string().optional(),
  priceText: z.string().optional(),
  productQuoteLinesJson: z.string().optional(),
  callbackNotes: z.string().optional(),
  source: z.string().optional(),
  summary: z.string().trim().min(1, "Add a short note about what happened on the call."),
  internalNotes: z.string().optional(),
  direction: zCallDirection,
  outcomeCode: z.string().min(1, "Pick a call result."),
  followUpAt: z.string().optional(),
});

async function resolveCallLogSourceForUpdate(
  clientId: string,
  callLogId: string,
  proposedRaw: string,
): Promise<string | null> {
  const t = proposedRaw.trim();
  if (!t) return null;
  const { data: active, error: activeErr } = await sb()
    .from(tables.LeadSourceOption)
    .select("code")
    .eq("code", t)
    .eq("active", true)
    .maybeSingle();
  if (activeErr) {
    if (!isMissingLeadSourceRelationError(activeErr)) throw activeErr;
    if (isLeadSourceFallbackActiveCode(t)) return t;
  } else if (active) {
    return t;
  }
  const { data: existingLog } = await sb()
    .from(tables.CallLog)
    .select("source")
    .eq("id", callLogId)
    .eq("clientId", clientId)
    .maybeSingle();
  const prev = (existingLog?.source as string | null) ?? null;
  if (prev !== null && prev === t) return t;
  throw new UserInputError(
    "Choose a lead source from the list, clear it, or keep the value already saved on this call.",
  );
}

export async function updateCallLogForClient(input: z.infer<typeof updateCallLogSchema>) {
  const data = updateCallLogSchema.parse(input);

  const phoneDigits = normalizeCallLogPhoneDigits(data.contactPhone ?? "");
  assertCallLogPhoneValid(phoneDigits);
  assertContactNameValid(data.contactName);
  const resolvedSource = await resolveCallLogSourceForUpdate(data.clientId, data.callLogId, data.source ?? "");

  await requireActiveOutcomeCode(data.outcomeCode);

  const { data: row, error: fErr } = await sb()
    .from(tables.CallLog)
    .select("id,outcomeCode,followUpAt")
    .eq("id", data.callLogId)
    .eq("clientId", data.clientId)
    .maybeSingle();
  if (fErr) throw fErr;
  if (!row) {
    throw new Error("Call log not found for this client.");
  }

  const prevOutcome = row.outcomeCode as string;
  const prevFollow = row.followUpAt ? toDate(row.followUpAt as string) : null;
  const outcomeChanged = data.outcomeCode !== prevOutcome;

  let followUpAtIso: string | null;
  if (outcomeChanged) {
    if (OUTCOME_CODES_CLEAR_FOLLOW_UP.has(data.outcomeCode)) {
      followUpAtIso = null;
    } else if (data.followUpAt?.trim()) {
      followUpAtIso = new Date(data.followUpAt).toISOString();
    } else {
      const auto = resolveFollowUpAfterOutcomeChange(data.outcomeCode, prevFollow);
      followUpAtIso = auto ? auto.toISOString() : null;
    }
  } else {
    followUpAtIso = data.followUpAt?.trim() ? new Date(data.followUpAt).toISOString() : null;
  }

  const ctx = {
    summary: data.summary,
    vehicleText: data.vehicleText,
    callbackNotes: data.callbackNotes,
    internalNotes: data.internalNotes,
  };

  let parsedLines = parseClientProductQuoteLinesJson(data.productQuoteLinesJson);
  if (!parsedLines.length) {
    parsedLines = [
      {
        product: String(data.product ?? ""),
        priceText: String(data.priceText ?? ""),
      },
    ].filter((r) => r.product.trim() || r.priceText.trim());
  }

  let resolvedLines: Array<{ product: string; priceText: string | null }>;
  if (parsedLines.length === 0) {
    const code = await resolveStoredProductCodeForCallLog({
      product: "",
      ...ctx,
    });
    resolvedLines = [{ product: code, priceText: null }];
  } else {
    resolvedLines = await resolveCallLogProductQuoteLines(parsedLines, ctx);
  }

  const primary = resolvedLines[0]!;

  const { error: uErr } = await sb()
    .from(tables.CallLog)
    .update({
      happenedAt: new Date(data.happenedAt).toISOString(),
      direction: data.direction,
      outcomeCode: data.outcomeCode,
      summary: data.summary,
      contactPhone: phoneDigits || null,
      contactName: data.contactName?.trim() || null,
      vehicleText: data.vehicleText?.trim() || null,
      product: primary.product,
      priceText: primary.priceText,
      productQuoteLines: resolvedLines as unknown as Record<string, unknown>[],
      callbackNotes: data.callbackNotes?.trim() || null,
      source: resolvedSource,
      internalNotes: data.internalNotes?.trim() || null,
      followUpAt: followUpAtIso,
      telephonyDraft: false,
      telephonyCallbackPending: false,
    })
    .eq("id", row.id);
  if (uErr) throw uErr;

  await reconcileTelephonyCallbacksIfLatestCallAnswered(data.clientId);
}

export async function addAppointment(input: z.infer<typeof appointmentSchema>, userId: string) {
  const data = appointmentSchema.parse(input);
  await requireActiveBookingTypeCode(data.type);
  const startRaw = new Date(data.startAt);
  if (Number.isNaN(startRaw.getTime())) {
    throw new Error("Invalid start time.");
  }
  const allDay = Boolean(data.allDay);
  const allDayBounds = allDay ? allDayBoundsInAppTimezone(startRaw) : null;
  const startAt = allDayBounds ? allDayBounds.start : startRaw;
  const endAt = allDayBounds ? allDayBounds.end : addMinutes(startRaw, data.durationMins);
  const capacitySlot = startAt.toISOString().slice(0, 16);

  const guestStored = data.guestEmails?.trim() ? data.guestEmails.trim() : null;
  const locationStored = data.location?.trim() ? data.location.trim() : null;
  const recurrenceStored = data.recurrenceRule?.trim() ? data.recurrenceRule.trim() : null;
  const kind = data.calendarEntryKind;
  const depositStored = normalizeAppointmentDepositText(data.depositText ?? null);
  const callLogIdRaw = data.callLogId?.trim() ? data.callLogId.trim() : null;
  if (callLogIdRaw) {
    const { data: clRow, error: clErr } = await sb()
      .from(tables.CallLog)
      .select("id, clientId")
      .eq("id", callLogIdRaw)
      .maybeSingle();
    if (clErr) throw clErr;
    if (!clRow || (clRow.clientId as string) !== data.clientId) {
      throw new Error("That call does not belong to this client.");
    }
    const { error: clearErr } = await sb()
      .from(tables.Appointment)
      .update({ callLogId: null, updatedAt: nowIso() })
      .eq("callLogId", callLogIdRaw);
    if (clearErr) throw clearErr;
  }

  const { data: calRow } = await sb().from(tables.CalendarConfig).select("calendarId").limit(1).maybeSingle();
  const { data: creatorRow } = await sb()
    .from(tables.User)
    .select("googleRefreshToken, googleCalendarId")
    .eq("id", userId)
    .maybeSingle();
  const gPlan = resolveAppointmentGoogleSync(
    calRow as { calendarId?: string | null } | null,
    creatorRow as { googleRefreshToken?: string | null; googleCalendarId?: string | null } | null,
  );
  const googleSyncStatus = gPlan.mode !== "none" ? GoogleSyncStatus.PENDING : GoogleSyncStatus.NOT_CONFIGURED;

  const appointmentId = newId();
  const insertRow = {
    id: appointmentId,
    clientId: data.clientId,
    vehicleId: data.vehicleId || null,
    createdById: userId,
    title: data.title,
    type: data.type,
    status: AppointmentStatus.CONFIRMED,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    resourceKey: data.resourceKey,
    capacitySlot,
    googleEventId: null as string | null,
    googleSyncStatus,
    notes: data.notes ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    calendarEntryKind: kind,
    location: locationStored,
    guestEmails: guestStored,
    allDay,
    recurrenceRule: recurrenceStored,
    showAs: data.showAs,
    visibility: data.visibility,
    depositText: depositStored,
    callLogId: callLogIdRaw,
  };

  const { error } = await sb().from(tables.Appointment).insert(insertRow);
  if (error) throw error;

  const googlePayload = {
    summary: googleCalendarSummaryForCrmTitle(data.title, kind),
    description: googleCalendarDescriptionForAppointment(data.notes ?? null, depositStored),
    start: startAt,
    end: endAt,
    allDay,
    location: locationStored,
    attendeeEmails: parseGuestEmailsFromRaw(guestStored),
    showAs: data.showAs,
    visibility: data.visibility,
    recurrence: toGoogleRecurrenceArray(recurrenceStored),
  };

  if (gPlan.mode === "user") {
    try {
      const eventId = await insertCalendarEventWithRefreshToken(gPlan.refreshToken, {
        calendarId: gPlan.calendarId,
        ...googlePayload,
      });
      const { error: uErr } = await sb()
        .from(tables.Appointment)
        .update({
          googleEventId: eventId,
          googleSyncStatus: GoogleSyncStatus.SYNCED,
          updatedAt: nowIso(),
        })
        .eq("id", appointmentId);
      if (uErr) throw uErr;
    } catch {
      const { error: fErr } = await sb()
        .from(tables.Appointment)
        .update({
          googleSyncStatus: GoogleSyncStatus.FAILED,
          updatedAt: nowIso(),
        })
        .eq("id", appointmentId);
      if (fErr) throw fErr;
    }
  } else if (gPlan.mode === "env") {
    try {
      const eventId = await insertCalendarEvent({
        calendarId: gPlan.calendarId,
        ...googlePayload,
      });
      const { error: uErr } = await sb()
        .from(tables.Appointment)
        .update({
          googleEventId: eventId,
          googleSyncStatus: GoogleSyncStatus.SYNCED,
          updatedAt: nowIso(),
        })
        .eq("id", appointmentId);
      if (uErr) throw uErr;
    } catch {
      const { error: fErr } = await sb()
        .from(tables.Appointment)
        .update({
          googleSyncStatus: GoogleSyncStatus.FAILED,
          updatedAt: nowIso(),
        })
        .eq("id", appointmentId);
      if (fErr) throw fErr;
    }
  }
}

export async function getAppointmentForEditor(id: string): Promise<AppointmentEditorModel | null> {
  const { data: row, error } = await sb().from(tables.Appointment).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const clientMap = await fetchClientsByIds([row.clientId as string]);
  const client = clientMap.get(row.clientId as string);
  if (!client) return null;

  const r = row as Record<string, unknown>;
  const vehicleIdRow = (r.vehicleId as string | null) ?? null;
  let vehicleLabel = "";
  if (vehicleIdRow) {
    const { data: vRow } = await sb().from(tables.Vehicle).select("label").eq("id", vehicleIdRow).maybeSingle();
    vehicleLabel = String((vRow as { label?: string } | null)?.label ?? "");
  }
  const base: AppointmentEditorModel = {
    id: r.id as string,
    clientId: r.clientId as string,
    vehicleId: vehicleIdRow,
    vehicleLabel,
    title: r.title as string,
    type: r.type as string,
    startAt: toDate(r.startAt as string),
    endAt: toDate(r.endAt as string),
    resourceKey: r.resourceKey as string,
    notes: (r.notes as string | null) ?? null,
    googleEventId: (r.googleEventId as string | null) ?? null,
    calendarEntryKind: (r.calendarEntryKind as string) || "EVENT",
    location: (r.location as string | null) ?? null,
    guestEmails: (r.guestEmails as string | null) ?? null,
    allDay: Boolean(r.allDay),
    recurrenceRule: (r.recurrenceRule as string | null) ?? null,
    showAs: (r.showAs as string) || "busy",
    visibility: (r.visibility as string) || "default",
    depositText: (r.depositText as string | null) ?? null,
    callLogId: (r.callLogId as string | null) ?? null,
    linkedCall: null,
    client,
  };
  const callLogId = base.callLogId;
  if (callLogId) {
    const { data: cl } = await sb()
      .from(tables.CallLog)
      .select("id, happenedAt, summary")
      .eq("id", callLogId)
      .maybeSingle();
    if (cl) {
      base.linkedCall = {
        id: cl.id as string,
        happenedAt: toDate(cl.happenedAt as string),
        summary: String((cl.summary as string) ?? ""),
      };
    }
  }
  return base;
}

/** Move a CRM booking to a new start time; duration and other fields stay the same. Syncs Google when linked. */
export async function rescheduleCrmAppointment(appointmentId: string, newStartAt: Date, userId: string): Promise<void> {
  const appt = await getAppointmentForEditor(appointmentId);
  if (!appt) {
    throw new Error("Booking not found.");
  }
  if (appt.allDay) {
    throw new Error("All-day bookings cannot be dragged on the grid. Open edit to change them.");
  }
  const durMins = Math.max(15, differenceInMinutes(appt.endAt, appt.startAt));
  const newEnd = addMinutes(newStartAt, durMins);
  if (newEnd.getTime() <= newStartAt.getTime()) {
    throw new Error("Invalid time range.");
  }

  const kind = (CALENDAR_ENTRY_KINDS as readonly string[]).includes(appt.calendarEntryKind)
    ? (appt.calendarEntryKind as (typeof CALENDAR_ENTRY_KINDS)[number])
    : "EVENT";
  const visibility =
    appt.visibility === "public" || appt.visibility === "private" || appt.visibility === "confidential"
      ? appt.visibility
      : ("default" as const);

  await updateAppointment(
    {
      appointmentId: appt.id,
      clientId: appt.clientId,
      vehicleId: appt.vehicleId ?? "",
      title: appt.title,
      type: appt.type,
      startAt: newStartAt.toISOString(),
      endAt: newEnd.toISOString(),
      resourceKey: appt.resourceKey,
      notes: appt.notes,
      calendarEntryKind: kind,
      location: appt.location,
      guestEmails: appt.guestEmails,
      allDay: false,
      recurrenceRule: appt.recurrenceRule,
      showAs: appt.showAs === "free" ? "free" : "busy",
      visibility,
      depositText: appt.depositText ?? null,
    },
    userId,
  );
}

export async function updateAppointment(input: z.infer<typeof updateAppointmentSchema>, userId: string) {
  const data = updateAppointmentSchema.parse(input);
  await requireActiveBookingTypeCode(data.type);

  const { data: existing, error: exErr } = await sb()
    .from(tables.Appointment)
    .select("id, googleEventId")
    .eq("id", data.appointmentId)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!existing) {
    throw new Error("Booking not found.");
  }

  const startAt = new Date(data.startAt);
  const endAt = new Date(data.endAt);
  const allDay = Boolean(data.allDay);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new Error("Invalid start or end time.");
  }
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error("End time must be after start time.");
  }

  const guestStored = data.guestEmails?.trim() ? data.guestEmails.trim() : null;
  const locationStored = data.location?.trim() ? data.location.trim() : null;
  const recurrenceStored = data.recurrenceRule?.trim() ? data.recurrenceRule.trim() : null;
  const kind = data.calendarEntryKind;
  const capacitySlot = startAt.toISOString().slice(0, 16);
  const depositStored = normalizeAppointmentDepositText(data.depositText ?? null);

  const { data: updatedRows, error: uErr } = await sb()
    .from(tables.Appointment)
    .update({
      clientId: data.clientId,
      vehicleId: data.vehicleId || null,
      title: data.title,
      type: data.type,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      resourceKey: data.resourceKey,
      capacitySlot,
      notes: data.notes ?? null,
      calendarEntryKind: kind,
      location: locationStored,
      guestEmails: guestStored,
      allDay,
      recurrenceRule: recurrenceStored,
      showAs: data.showAs,
      visibility: data.visibility,
      depositText: depositStored,
      updatedAt: nowIso(),
    })
    .eq("id", data.appointmentId)
    .select("id");
  if (uErr) throw uErr;
  if (!updatedRows?.length) {
    throw new Error("Could not update this booking — it may have been removed.");
  }

  const googleEventId = existing.googleEventId as string | null;
  if (!googleEventId) return;

  const { data: calRow } = await sb().from(tables.CalendarConfig).select("calendarId").limit(1).maybeSingle();
  const { data: creatorRow } = await sb()
    .from(tables.User)
    .select("googleRefreshToken, googleCalendarId")
    .eq("id", userId)
    .maybeSingle();
  const gPlan = resolveAppointmentGoogleSync(
    calRow as { calendarId?: string | null } | null,
    creatorRow as { googleRefreshToken?: string | null; googleCalendarId?: string | null } | null,
  );
  if (gPlan.mode === "none") return;

  const googleRecurrence = toGoogleRecurrenceArray(recurrenceStored);
  const patchBody = {
    summary: googleCalendarSummaryForCrmTitle(data.title, kind),
    description: googleCalendarDescriptionForAppointment(data.notes ?? null, depositStored),
    start: startAt,
    end: endAt,
    allDay,
    location: locationStored,
    attendeeEmails: parseGuestEmailsFromRaw(guestStored),
    showAs: data.showAs as "busy" | "free",
    visibility: data.visibility as "default" | "public" | "private" | "confidential",
    ...(googleRecurrence?.length ? { recurrence: googleRecurrence } : {}),
  };

  try {
    if (gPlan.mode === "user") {
      await patchCalendarEventWithRefreshToken(gPlan.refreshToken, gPlan.calendarId, googleEventId, patchBody);
    } else {
      await patchCalendarEvent(gPlan.calendarId, googleEventId, patchBody);
    }
    await sb()
      .from(tables.Appointment)
      .update({ googleSyncStatus: GoogleSyncStatus.SYNCED, updatedAt: nowIso() })
      .eq("id", data.appointmentId);
  } catch {
    await sb()
      .from(tables.Appointment)
      .update({ googleSyncStatus: GoogleSyncStatus.FAILED, updatedAt: nowIso() })
      .eq("id", data.appointmentId);
  }
}

/** Updates only start/end (and capacity slot); syncs Google when linked. For timed bookings from the calendar quick-adjust UI. */
export async function patchAppointmentTimesOnly(
  appointmentId: string,
  startAtIso: string,
  endAtIso: string,
  userId: string,
): Promise<void> {
  const startAt = new Date(startAtIso);
  const endAt = new Date(endAtIso);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new Error("Invalid start or end time.");
  }
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error("End time must be after start time.");
  }

  const { data: row, error: exErr } = await sb()
    .from(tables.Appointment)
    .select(
      "id, googleEventId, title, notes, depositText, calendarEntryKind, location, guestEmails, allDay, recurrenceRule, showAs, visibility",
    )
    .eq("id", appointmentId)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!row) throw new Error("Booking not found.");

  const r = row as Record<string, unknown>;
  if (Boolean(r.allDay)) {
    throw new Error("Open the full editor to change all-day bookings.");
  }

  const capacitySlot = startAt.toISOString().slice(0, 16);
  const { data: updatedRows, error: uErr } = await sb()
    .from(tables.Appointment)
    .update({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      capacitySlot,
      updatedAt: nowIso(),
    })
    .eq("id", appointmentId)
    .select("id");
  if (uErr) throw uErr;
  if (!updatedRows?.length) {
    throw new Error("Could not update this booking.");
  }

  const googleEventId = (r.googleEventId as string | null)?.trim() || null;
  if (!googleEventId) return;

  const kind = String(r.calendarEntryKind || "EVENT");
  const recurrenceStored = (r.recurrenceRule as string | null)?.trim() || null;
  const guestStored = (r.guestEmails as string | null)?.trim() || null;
  const locationStored = (r.location as string | null)?.trim() || null;
  const showAs = r.showAs === "free" ? ("free" as const) : ("busy" as const);
  const visibilityRaw = String(r.visibility || "default");
  const visibility =
    visibilityRaw === "public" || visibilityRaw === "private" || visibilityRaw === "confidential"
      ? visibilityRaw
      : ("default" as const);

  const { data: calRow } = await sb().from(tables.CalendarConfig).select("calendarId").limit(1).maybeSingle();
  const { data: creatorRow } = await sb()
    .from(tables.User)
    .select("googleRefreshToken, googleCalendarId")
    .eq("id", userId)
    .maybeSingle();
  const gPlan = resolveAppointmentGoogleSync(
    calRow as { calendarId?: string | null } | null,
    creatorRow as { googleRefreshToken?: string | null; googleCalendarId?: string | null } | null,
  );
  if (gPlan.mode === "none") return;

  const googleRecurrence = toGoogleRecurrenceArray(recurrenceStored);
  const depositForGoogle = normalizeAppointmentDepositText((r.depositText as string | null) ?? null);
  const patchBody = {
    summary: googleCalendarSummaryForCrmTitle(String(r.title || ""), kind),
    description: googleCalendarDescriptionForAppointment((r.notes as string | null) ?? null, depositForGoogle),
    start: startAt,
    end: endAt,
    allDay: false,
    location: locationStored || null,
    attendeeEmails: parseGuestEmailsFromRaw(guestStored),
    showAs,
    visibility: visibility as "default" | "public" | "private" | "confidential",
    ...(googleRecurrence?.length ? { recurrence: googleRecurrence } : {}),
  };

  try {
    if (gPlan.mode === "user") {
      await patchCalendarEventWithRefreshToken(gPlan.refreshToken, gPlan.calendarId, googleEventId, patchBody);
    } else {
      await patchCalendarEvent(gPlan.calendarId, googleEventId, patchBody);
    }
    await sb()
      .from(tables.Appointment)
      .update({ googleSyncStatus: GoogleSyncStatus.SYNCED, updatedAt: nowIso() })
      .eq("id", appointmentId);
  } catch {
    await sb()
      .from(tables.Appointment)
      .update({ googleSyncStatus: GoogleSyncStatus.FAILED, updatedAt: nowIso() })
      .eq("id", appointmentId);
  }
}

/** For cache revalidation of `/clients/[id]` after booking changes. */
export async function getAppointmentClientId(appointmentId: string): Promise<string | null> {
  const { data, error } = await sb()
    .from(tables.Appointment)
    .select("clientId")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data.clientId as string;
}

/**
 * Removes a CRM booking and best-effort deletes the linked Google event (same token/calendar
 * resolution as updates — acting user's OAuth or env shop calendar).
 */
export async function deleteAppointment(appointmentId: string, userId: string): Promise<void> {
  const { data: row, error: exErr } = await sb()
    .from(tables.Appointment)
    .select("id, googleEventId")
    .eq("id", appointmentId)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!row) {
    throw new Error("Booking not found.");
  }

  const googleEventId = ((row as { googleEventId?: string | null }).googleEventId ?? "").trim() || null;

  const { data: calRow } = await sb().from(tables.CalendarConfig).select("calendarId").limit(1).maybeSingle();
  const { data: actorRow } = await sb()
    .from(tables.User)
    .select("googleRefreshToken, googleCalendarId")
    .eq("id", userId)
    .maybeSingle();
  const gPlan = resolveAppointmentGoogleSync(
    calRow as { calendarId?: string | null } | null,
    actorRow as { googleRefreshToken?: string | null; googleCalendarId?: string | null } | null,
  );

  if (googleEventId && gPlan.mode !== "none") {
    try {
      if (gPlan.mode === "user") {
        await deleteCalendarEventWithRefreshToken(gPlan.refreshToken, gPlan.calendarId, googleEventId);
      } else {
        await deleteCalendarEvent(gPlan.calendarId, googleEventId);
      }
    } catch {
      /* orphan event on Google is acceptable if API/network fails */
    }
  }

  const { error: dErr } = await sb().from(tables.Appointment).delete().eq("id", appointmentId);
  if (dErr) throw dErr;
}

export async function disconnectUserGoogleCalendar(userId: string) {
  const { error } = await sb()
    .from(tables.User)
    .update({
      googleRefreshToken: null,
      googleCalendarId: null,
      updatedAt: nowIso(),
    })
    .eq("id", userId);
  if (error) throw error;
}

export async function updateUserGoogleCalendarId(userId: string, rawCalendarId: string) {
  const trimmed = rawCalendarId.trim();
  const googleCalendarId = trimmed.length > 0 ? trimmed : null;
  const { error } = await sb()
    .from(tables.User)
    .update({
      googleCalendarId,
      updatedAt: nowIso(),
    })
    .eq("id", userId);
  if (error) throw error;
}

type ParsedCsvRow = Record<string, string | undefined>;

/** Collapse BOM, trim header keys (e.g. Google Sheets column " Product" becomes Product). */
function trimCsvRowKeys(row: ParsedCsvRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.replace(/\uFEFF/g, "").trim();
    if (!key) continue;
    out[key] = v == null ? "" : String(v).trim();
  }
  return out;
}

/**
 * Maps "Car Systems Calls" and compatible spreadsheets → canonical fields.
 * Headers: Date, Time, Number, Name, Vehicle, Product, Price, Call backs, Extra comments…, Found us through
 */
function legacyCallCsvFields(row: Record<string, string>) {
  const g = (...keys: string[]) => {
    for (const key of keys) {
      const v = row[key];
      if (v != null && v !== "") return v;
    }
    return "";
  };

  return {
    date: g("Date"),
    time: g("Time"),
    number: g("Number", "Phone", "phone"),
    name: g("Name"),
    vehicle: g("Vehicle"),
    product: g("Product"),
    price: g("Price", "Quote"),
    callBacks: g("Call backs", "Callbacks", "Call Backs"),
    extraComments: g("Extra comments DO NOT DISCLOSE TO CUSTOMER", "Extra comments"),
    foundUs: g("Found us through", "Found us", "Source"),
  };
}

export async function importCsvText(input: z.infer<typeof importCsvSchema>, uploadedById: string) {
  const data = importCsvSchema.parse(input);
  const parsed = Papa.parse<ParsedCsvRow>(data.csvText, {
    header: true,
    skipEmptyLines: "greedy",
  });

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(
      first.row != null
        ? `CSV parse error at row ${first.row + 1}: ${first.message}`
        : `CSV parse error: ${first.message}`,
    );
  }

  const batchId = newId();
  const { error: bErr } = await sb().from(tables.ImportBatch).insert({
    id: batchId,
    uploadedById,
    fileName: data.fileName,
    originalCsvText: data.csvText,
    rowCount: parsed.data.length,
    importedCount: 0,
    reviewCount: 0,
    status: ImportStatus.DRAFT,
    createdAt: nowIso(),
  });
  if (bErr) throw bErr;

  let importedCount = 0;
  let reviewCount = 0;

  const psRows = await getProductServiceOptions(true);
  const psResolve: ProductServiceResolveRow[] = psRows.map((r) => ({
    code: String(r.code),
    label: String(r.label),
    matchTerms: String((r as { matchTerms?: string }).matchTerms ?? ""),
    active: Boolean(r.active),
  }));

  for (const [index, rawRow] of parsed.data.entries()) {
    const row = trimCsvRowKeys(rawRow);
    const f = legacyCallCsvFields(row);

    const phone = normalizePhone(f.number);
    const summary = [
      f.product.trim() || null,
      f.price ? `Notes / quote: ${f.price}` : null,
      f.callBacks || null,
      f.extraComments ? `(internal) ${f.extraComments}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const haystackForProduct = [f.product, summary, f.vehicle, f.callBacks, f.extraComments].filter(Boolean).join(" | ");
    const productCode = resolveProductServiceCodeFromHaystack(f.product.trim(), haystackForProduct, psResolve);

    const rowHasContent =
      phone ||
      f.name ||
      f.vehicle ||
      f.product.trim() ||
      f.price ||
      f.callBacks ||
      f.extraComments ||
      f.foundUs;
    if (!rowHasContent) {
      const { error: irSkip } = await sb().from(tables.ImportRow).insert({
        id: newId(),
        batchId,
        matchedClientId: null,
        rowNumber: index + 1,
        normalizedPhone: null,
        status: ImportRowStatus.SKIPPED,
        warning: "Empty row",
        rawJson: JSON.stringify(row),
        createdAt: nowIso(),
      });
      if (irSkip) throw irSkip;
      continue;
    }

    let existingContact: { clientId: string } | null = null;
    if (phone) {
      const { data: cp } = await sb()
        .from(tables.ContactPoint)
        .select("clientId")
        .eq("normalizedValue", phone)
        .eq("kind", "PHONE")
        .limit(1)
        .maybeSingle();
      if (cp) existingContact = { clientId: cp.clientId as string };
    }

    let clientId = existingContact?.clientId;
    let warning: string | null = null;

    if (!clientId) {
      const cid = newId();
      const { error: cErr } = await sb().from(tables.Client).insert({
        id: cid,
        displayName: f.name.trim() || "Unknown caller",
        source: f.foundUs.trim() || "CSV import",
        notes: f.extraComments.trim() || null,
        companyName: null,
        tags: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      if (cErr) throw cErr;

      if (phone) {
        const { error: pErr } = await sb().from(tables.ContactPoint).insert({
          id: newId(),
          clientId: cid,
          kind: "PHONE",
          value: f.number || phone,
          normalizedValue: phone,
          isPrimary: true,
          createdAt: nowIso(),
        });
        if (pErr) throw pErr;
      }

      if (f.vehicle.trim()) {
        const v = parseVehicleLabel(f.vehicle);
        const { error: vErr } = await sb().from(tables.Vehicle).insert({
          id: newId(),
          clientId: cid,
          label: v.label,
          year: v.year,
          make: v.make,
          model: v.model,
          trim: null,
          notes: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
        if (vErr) throw vErr;
      }

      const { error: oErr } = await sb().from(tables.Opportunity).insert({
        id: newId(),
        clientId: cid,
        vehicleId: null,
        product: productCode,
        status: inferOpportunityStatus(summary),
        estimateText: f.price.trim() || null,
        summary: summary || "Imported from historical CSV",
        source: f.foundUs.trim() || "CSV import",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      if (oErr) throw oErr;

      clientId = cid;
    } else {
      warning = "Matched existing client by normalized phone number.";
    }

    if (clientId) {
      const { error: clErr } = await sb().from(tables.CallLog).insert({
        id: newId(),
        clientId,
        userId: uploadedById,
        direction: CallDirection.INBOUND,
        happenedAt: csvToDate(f.date, f.time).toISOString(),
        summary: summary || "Imported historical call note",
        outcomeCode: inferOutcome(summary),
        contactPhone: phone,
        contactName: f.name.trim() || null,
        vehicleText: f.vehicle.trim() || null,
        product: productCode,
        priceText: f.price.trim() || null,
        callbackNotes: f.callBacks.trim() || null,
        source: f.foundUs.trim() || "CSV import",
        internalNotes: f.extraComments.trim() || null,
        followUpAt: null,
        createdAt: nowIso(),
      });
      if (clErr) throw clErr;
      importedCount += 1;
    } else {
      reviewCount += 1;
      warning = "No client match could be created from this row.";
    }

    const { error: irErr } = await sb().from(tables.ImportRow).insert({
      id: newId(),
      batchId,
      matchedClientId: clientId ?? null,
      rowNumber: index + 1,
      normalizedPhone: phone,
      status: clientId ? ImportRowStatus.IMPORTED : ImportRowStatus.REVIEW,
      warning,
      rawJson: JSON.stringify(row),
      createdAt: nowIso(),
    });
    if (irErr) throw irErr;
  }

  const finalStatus = reviewCount > 0 ? ImportStatus.PARTIAL : ImportStatus.IMPORTED;
  const { error: upErr } = await sb()
    .from(tables.ImportBatch)
    .update({
      importedCount,
      reviewCount,
      status: finalStatus,
    })
    .eq("id", batchId);
  if (upErr) throw upErr;

  const { data: batch, error: gErr } = await sb().from(tables.ImportBatch).select("*").eq("id", batchId).single();
  if (gErr) throw gErr;
  return batch;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createWorkspaceUser(input: {
  name: string;
  email: string;
  role: UserRole;
  team?: string | null;
  privilegeOverrides?: PrivilegeOverrides | null;
}) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) {
    throw new Error("Enter a name with at least 2 characters.");
  }
  if (!EMAIL_RE.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  const { data: dup, error: dErr } = await sb().from(tables.User).select("id").eq("email", email).maybeSingle();
  if (dErr) throw dErr;
  if (dup) {
    throw new Error("That email is already assigned to a user.");
  }
  const privilegeOverrides =
    input.role === UserRole.ADMIN ? null : (input.privilegeOverrides === undefined ? null : input.privilegeOverrides);
  const row = {
    id: newId(),
    name,
    email,
    role: input.role,
    team: input.team?.trim() ? input.team.trim() : null,
    privilegeOverrides: privilegeOverrides && Object.keys(privilegeOverrides).length > 0 ? privilegeOverrides : null,
    googleRefreshToken: null as string | null,
    googleCalendarId: null as string | null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const { error } = await sb().from(tables.User).insert(row);
  if (error) throw error;
  return row;
}

export async function updateWorkspaceUser(
  id: string,
  input: {
    name: string;
    email: string;
    role: UserRole;
    team?: string | null;
    /** Merged from form; null clears overrides (role defaults only). Ignored when role is ADMIN. */
    privilegeOverrides: PrivilegeOverrides | null;
  },
) {
  const trimmedId = id.trim();
  if (!trimmedId) {
    throw new Error("Missing user.");
  }
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) {
    throw new Error("Enter a name with at least 2 characters.");
  }
  if (!EMAIL_RE.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  const { data: existing, error: fErr } = await sb().from(tables.User).select("id,role").eq("id", trimmedId).maybeSingle();
  if (fErr) throw fErr;
  if (!existing) {
    throw new Error("User not found.");
  }
  const { data: emailDup, error: eErr } = await sb()
    .from(tables.User)
    .select("id")
    .eq("email", email)
    .neq("id", trimmedId)
    .maybeSingle();
  if (eErr) throw eErr;
  if (emailDup) {
    throw new Error("That email is already assigned to another user.");
  }
  const prevRole = existing.role as UserRole;
  const nextRole = input.role;
  if (prevRole === UserRole.ADMIN && nextRole !== UserRole.ADMIN) {
    const { count, error: cErr } = await sb()
      .from(tables.User)
      .select("*", { count: "exact", head: true })
      .eq("role", UserRole.ADMIN);
    if (cErr) throw cErr;
    if ((count ?? 0) <= 1) {
      throw new Error("Keep at least one administrator.");
    }
  }
  const team = input.team?.trim() ? input.team.trim() : null;
  const privilegeOverrides =
    nextRole === UserRole.ADMIN
      ? null
      : input.privilegeOverrides && Object.keys(input.privilegeOverrides).length > 0
        ? input.privilegeOverrides
        : null;
  const { error: uErr } = await sb()
    .from(tables.User)
    .update({
      name,
      email,
      role: nextRole,
      team,
      privilegeOverrides,
      updatedAt: nowIso(),
    })
    .eq("id", trimmedId);
  if (uErr) throw uErr;
}

/**
 * Google Sign-In: if the workspace has no users yet, creates the first ADMIN.
 * Otherwise requires an existing User row with this email (add people under Workspace → Team).
 */
export async function signInOrBootstrapUserFromGoogle(input: {
  email: string;
  displayName: string;
}): Promise<{ email: string; bootstrap: boolean }> {
  const email = input.email.trim().toLowerCase();
  const name = input.displayName.trim() || email.split("@")[0] || "User";
  if (!EMAIL_RE.test(email)) {
    throw new Error("Google did not return a valid email.");
  }
  if (name.length < 2) {
    throw new Error("Google did not return a usable name.");
  }

  const { data: existing, error: eErr } = await sb().from(tables.User).select("id,email").eq("email", email).maybeSingle();
  if (eErr) throw eErr;
  if (existing) {
    return { email, bootstrap: false };
  }

  const { count, error: cErr } = await sb().from(tables.User).select("*", { count: "exact", head: true });
  if (cErr) throw cErr;
  if ((count ?? 0) > 0) {
    const err = new Error(
      "NOT_INVITED: This Google account is not on your team yet. Ask an administrator to add your email under Workspace → Team.",
    );
    (err as Error & { code?: string }).code = "NOT_INVITED";
    throw err;
  }

  await createWorkspaceUser({
    name,
    email,
    role: UserRole.ADMIN,
    team: null,
    privilegeOverrides: null,
  });
  return { email, bootstrap: true };
}

export async function deleteWorkspaceUser(id: string) {
  const trimmedId = id.trim();
  if (!trimmedId) {
    throw new Error("Missing user.");
  }
  const { data: row, error: fErr } = await sb().from(tables.User).select("id,role").eq("id", trimmedId).maybeSingle();
  if (fErr) throw fErr;
  if (!row) {
    throw new Error("User not found.");
  }
  if ((row.role as UserRole) === UserRole.ADMIN) {
    const { count, error: cErr } = await sb()
      .from(tables.User)
      .select("*", { count: "exact", head: true })
      .eq("role", UserRole.ADMIN);
    if (cErr) throw cErr;
    if ((count ?? 0) <= 1) {
      throw new Error("Cannot remove the last administrator.");
    }
  }
  const [clRes, aptRes, impRes] = await Promise.all([
    sb().from(tables.CallLog).select("*", { count: "exact", head: true }).eq("userId", trimmedId),
    sb().from(tables.Appointment).select("*", { count: "exact", head: true }).eq("createdById", trimmedId),
    sb().from(tables.ImportBatch).select("*", { count: "exact", head: true }).eq("uploadedById", trimmedId),
  ]);
  if (clRes.error) throw clRes.error;
  if (aptRes.error) throw aptRes.error;
  if (impRes.error) throw impRes.error;
  const refs = (clRes.count ?? 0) + (aptRes.count ?? 0) + (impRes.count ?? 0);
  if (refs > 0) {
    throw new Error(
      "This user has call logs, bookings, or imports in the system. Keep the account for history, or contact support to reassign data.",
    );
  }
  const { error: dErr } = await sb().from(tables.User).delete().eq("id", trimmedId);
  if (dErr) throw dErr;
}

export async function updateShopCalendarConfig(input: {
  calendarId: string;
  defaultDurationMins: number;
  maxParallelBookings: number;
}) {
  const { data: row, error: fErr } = await sb().from(tables.CalendarConfig).select("id").limit(1).maybeSingle();
  if (fErr) throw fErr;
  if (!row) {
    throw new Error("No calendar configuration row found. Run db:seed once or add a CalendarConfig row.");
  }
  const calendarId = input.calendarId.trim();
  if (calendarId.length < 2) {
    throw new Error("Enter the shop calendar ID used for bookings.");
  }
  const defaultDurationMins = Math.min(480, Math.max(15, Math.floor(Number(input.defaultDurationMins)) || 60));
  const maxParallelBookings = Math.min(50, Math.max(1, Math.floor(Number(input.maxParallelBookings)) || 1));
  const { error } = await sb()
    .from(tables.CalendarConfig)
    .update({
      calendarId,
      defaultDurationMins,
      maxParallelBookings,
      updatedAt: nowIso(),
    })
    .eq("id", row.id as string);
  if (error) throw error;
}

export {
  compactPrivilegeOverrides,
  getRolePrivilegeDefaults,
  getUserCapabilities,
  hasCustomPrivilegeOverrides,
  mergePrivileges,
  parsePrivilegeFieldsFromForm,
  type AccessLevel,
  type PrivilegeKey,
  type PrivilegeOverrides,
  type UserCapabilitySnapshot,
} from "./user-privileges";
