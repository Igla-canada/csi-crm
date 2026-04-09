"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { CRM_USER_COOKIE, getCrmSessionCookieOptions } from "@/lib/session-cookie";
import {
  addAppointment,
  addPaymentEvent,
  updatePaymentEvent,
  deletePaymentEvent,
  addCallLog,
  CALENDAR_ENTRY_KINDS,
  type CalendarEntryKind,
  AmbiguousPhoneMatchError,
  createClientForBooking,
  deleteAppointment,
  getAppointmentClientId,
  createCustomBookingTypeOption,
  createCustomCallResultOption,
  createCustomLeadSourceOption,
  createCustomProductServiceOption,
  disconnectUserGoogleCalendar,
  findClientsByNormalizedPhone,
  getClientCallLogPrefill,
  importCsvText,
  quickUpdateCallLogOutcomeCode,
  removeCustomBookingTypeOption,
  removeCustomCallResultOption,
  removeCustomLeadSourceOption,
  removeCustomProductServiceOption,
  resolveOrCreateVehicleForClient,
  setBookingTypeOptionActive,
  setCallResultOptionActive,
  setLeadSourceOptionActive,
  setProductServiceOptionActive,
  updateBookingTypeOptionAccent,
  updateBookingTypeOptionLabel,
  updateLeadSourceOptionLabel,
  updateProductServiceOptionLabel,
  updateProductServiceOptionMatchTerms,
  updateCallLogForClient,
  updateCallResultOptionAccent,
  patchAppointmentTimesOnly,
  rescheduleCrmAppointment,
  updateAppointment,
  updateCallResultOptionLabel,
  updateUserGoogleCalendarId,
  compactPrivilegeOverrides,
  createWorkspaceUser,
  getUserCapabilities,
  parsePrivilegeFieldsFromForm,
  updateWorkspaceUser,
  deleteWorkspaceUser,
  updateShopCalendarConfig,
  getClientDisplayName,
  getClientPrimaryPhoneValue,
  getVehicleLabelForClient,
  markCallLogOpenedFromCallHistory,
  markInboundTelephonyStubOpenedFromLiveDock,
} from "@/lib/crm";
import { CALL_OUTCOME_BOOKED_CODE } from "@/lib/booking-from-call";
import { PAYMENT_EVENT_KINDS, PAYMENT_EVENT_METHODS } from "@/lib/crm-types";
import { CallDirection, UserRole } from "@/lib/db";
import { getGoogleCalendarIdFromEnv, getGoogleRefreshToken } from "@/lib/google-calendar/env";
import { patchCalendarEventWithRefreshToken } from "@/lib/google-calendar/events";
import { resolveUserGoogleCalendarId } from "@/lib/google-calendar/sync-config";
import { normalizePhone } from "@/lib/phone";
import { UserInputError } from "@/lib/user-input-error";

export type OpenCallFromHistoryActionResult =
  | { ok: true; href: string }
  | { ok: false; message: string };

export type MarkInboundStubFromLiveDockResult =
  | { ok: true; marked: boolean; clientId: string | null }
  | { ok: false; message: string };

/** Marks the newest matching RingCentral stub so Call history hides “Open log” after dock “Open call log”. */
export async function markInboundStubOpenedFromLiveDockAction(
  phoneDigits: string,
): Promise<MarkInboundStubFromLiveDockResult> {
  const currentUser = await getCurrentUser();
  assertPrivilege(getUserCapabilities(currentUser).canLogCalls, "Your account can't log calls.");
  const digits = String(phoneDigits ?? "").trim();
  if (!digits) {
    return { ok: true, marked: false, clientId: null };
  }
  try {
    const r = await markInboundTelephonyStubOpenedFromLiveDock(digits);
    revalidatePath("/calls/history", "page");
    if (r.clientId) {
      revalidatePath(`/clients/${r.clientId}`, "page");
    }
    return { ok: true, marked: r.marked, clientId: r.clientId };
  } catch (e) {
    if (e instanceof UserInputError) {
      return { ok: false, message: e.message };
    }
    console.error(e);
    return { ok: false, message: "Something went wrong. Try again." };
  }
}

export async function openCallFromHistoryAction(formData: FormData): Promise<OpenCallFromHistoryActionResult> {
  const currentUser = await getCurrentUser();
  assertPrivilege(getUserCapabilities(currentUser).canLogCalls, "Your account can't log calls.");
  const callLogId = String(formData.get("callLogId") ?? "").trim();
  if (!callLogId) {
    return { ok: false, message: "Missing call." };
  }
  try {
    const { clientId } = await markCallLogOpenedFromCallHistory(callLogId);
    revalidatePath("/calls/history", "page");
    revalidatePath(`/clients/${clientId}`, "page");
    const href = `/clients/${clientId}?openCallLog=${encodeURIComponent(callLogId)}`;
    return { ok: true, href };
  } catch (e) {
    if (e instanceof UserInputError) {
      return { ok: false, message: e.message };
    }
    console.error(e);
    return { ok: false, message: "Something went wrong. Try again." };
  }
}

export async function disconnectGoogleCalendarAction() {
  const user = await getCurrentUser();
  await disconnectUserGoogleCalendar(user.id);
  revalidatePath("/settings", "page");
}

export async function saveMyGoogleCalendarIdAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user.googleRefreshToken?.trim()) {
    return;
  }
  const raw = String(formData.get("googleCalendarId") ?? "");
  await updateUserGoogleCalendarId(user.id, raw);
  revalidatePath("/settings", "page");
}

function assertPrivilege(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
}

async function requireAdminConfigure() {
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  if (!caps.canConfigure) {
    throw new Error("Only administrators can change this.");
  }
  return user;
}

function parseWorkspaceUserRole(raw: string): UserRole {
  const v = raw.trim();
  if (v === UserRole.ADMIN || v === UserRole.MANAGER || v === UserRole.SALES || v === UserRole.TECH) {
    return v;
  }
  throw new Error("Pick a valid role.");
}

export async function createWorkspaceUserAction(formData: FormData) {
  await requireAdminConfigure();
  const role = parseWorkspaceUserRole(String(formData.get("role") || ""));
  const desired = parsePrivilegeFieldsFromForm(formData, role);
  const privilegeOverrides = compactPrivilegeOverrides(role, desired);
  await createWorkspaceUser({
    name: String(formData.get("name") || ""),
    email: String(formData.get("email") || ""),
    role,
    team: String(formData.get("team") || ""),
    privilegeOverrides,
  });
  revalidatePath("/", "layout");
  revalidatePath("/settings", "page");
}

export async function updateWorkspaceUserAction(formData: FormData) {
  const admin = await requireAdminConfigure();
  const id = String(formData.get("id") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = parseWorkspaceUserRole(String(formData.get("role") || ""));
  const desired = parsePrivilegeFieldsFromForm(formData, role);
  const privilegeOverrides = compactPrivilegeOverrides(role, desired);
  await updateWorkspaceUser(id, {
    name: String(formData.get("name") || ""),
    email,
    role,
    team: String(formData.get("team") || ""),
    privilegeOverrides,
  });

  if (admin.id === id) {
    const cookieStore = await cookies();
    cookieStore.set(CRM_USER_COOKIE, email, getCrmSessionCookieOptions());
  }

  revalidatePath("/", "layout");
  revalidatePath("/settings", "page");
}

export async function deleteWorkspaceUserAction(formData: FormData) {
  await requireAdminConfigure();
  const id = String(formData.get("id") || "").trim();
  await deleteWorkspaceUser(id);
  revalidatePath("/", "layout");
  revalidatePath("/settings", "page");
}

export async function updateShopCalendarConfigAction(formData: FormData) {
  await requireAdminConfigure();
  await updateShopCalendarConfig({
    calendarId: String(formData.get("calendarId") || ""),
    defaultDurationMins: Number(formData.get("defaultDurationMins") || 60),
    maxParallelBookings: Number(formData.get("maxParallelBookings") || 5),
  });
  revalidatePath("/", "layout");
  revalidatePath("/settings", "page");
  revalidatePath("/appointments", "page");
}

export async function lookupClientsByPhoneAction(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return [];
  }
  return findClientsByNormalizedPhone(normalized);
}

export async function getClientCallLogPrefillAction(clientId: string) {
  if (!clientId.trim()) {
    return null;
  }
  return getClientCallLogPrefill(clientId.trim());
}

export type CreateCallLogActionState =
  | null
  | { ok: true; savedAt: number; callLogId: string; clientId: string; outcomeCode: string }
  | { ok: false; message: string };

function friendlyZodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Please check the form and try again.";
  }
  const path = issue.path[0];
  if (path === "summary") {
    return "Please add a short summary of what happened on this call.";
  }
  if (path === "contactName") {
    return "Please enter the customer name.";
  }
  if (path === "outcomeCode") {
    return "Please pick a call result.";
  }
  return issue.message;
}

export async function createCallLogAction(
  _prevState: CreateCallLogActionState,
  formData: FormData,
): Promise<CreateCallLogActionState> {
  const currentUser = await getCurrentUser();
  assertPrivilege(getUserCapabilities(currentUser).canLogCalls, "Your account can't log calls.");

  try {
    const { callLogId, clientId } = await addCallLog(
      {
        clientId: String(formData.get("clientId") || ""),
        callLogId: String(formData.get("callLogId") || ""),
        forceNewClient: String(formData.get("forceNewClient") || "") === "true",
        happenedAt: String(formData.get("happenedAt") || ""),
        contactPhone: String(formData.get("contactPhone") || ""),
        contactName: String(formData.get("contactName") || ""),
        vehicleText: String(formData.get("vehicleText") || ""),
        product: String(formData.get("product") || ""),
        priceText: String(formData.get("priceText") || ""),
        productQuoteLinesJson: String(formData.get("productQuoteLinesJson") || ""),
        callbackNotes: String(formData.get("callbackNotes") || ""),
        source: String(formData.get("source") || ""),
        summary: String(formData.get("summary") || ""),
        internalNotes: String(formData.get("internalNotes") || ""),
        direction: String(formData.get("direction") || "INBOUND") as
          | "INBOUND"
          | "OUTBOUND",
        outcomeCode: String(formData.get("outcomeCode") || "FOLLOW_UP"),
        followUpAt: String(formData.get("followUpAt") || ""),
      },
      currentUser.id,
    );

    revalidatePath("/", "page");
    revalidatePath("/clients", "page");
    revalidatePath(`/clients/${clientId}`, "page");
    revalidatePath("/reports", "page");
    revalidatePath("/appointments", "page");
    revalidatePath("/tasks", "page");

    return {
      ok: true,
      savedAt: Date.now(),
      callLogId,
      clientId,
      outcomeCode: String(formData.get("outcomeCode") || ""),
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, message: friendlyZodMessage(err) };
    }
    if (err instanceof AmbiguousPhoneMatchError) {
      return { ok: false, message: err.message };
    }
    if (err instanceof UserInputError) {
      return { ok: false, message: err.message };
    }
    console.error(err);
    return { ok: false, message: "Something went wrong while saving. Please try again." };
  }
}

export type UpdateCallLogActionState =
  | null
  | { ok: true; outcomeCode: string }
  | { ok: false; message: string };

export async function updateCallLogAction(
  _prev: UpdateCallLogActionState,
  formData: FormData,
): Promise<UpdateCallLogActionState> {
  const u = await getCurrentUser();
  assertPrivilege(getUserCapabilities(u).canEditCallLogs, "Your account can't edit call logs.");

  const clientId = String(formData.get("clientId") || "");

  try {
    await updateCallLogForClient({
      callLogId: String(formData.get("callLogId") || ""),
      clientId,
      happenedAt: String(formData.get("happenedAt") || ""),
      contactPhone: String(formData.get("contactPhone") || ""),
      contactName: String(formData.get("contactName") || ""),
      vehicleText: String(formData.get("vehicleText") || ""),
      product: String(formData.get("product") || ""),
      priceText: String(formData.get("priceText") || ""),
      productQuoteLinesJson: String(formData.get("productQuoteLinesJson") || ""),
      callbackNotes: String(formData.get("callbackNotes") || ""),
      source: String(formData.get("source") || ""),
      summary: String(formData.get("summary") || ""),
      internalNotes: String(formData.get("internalNotes") || ""),
      direction: String(formData.get("direction") || "INBOUND") as "INBOUND" | "OUTBOUND",
      outcomeCode: String(formData.get("outcomeCode") || "FOLLOW_UP"),
      followUpAt: String(formData.get("followUpAt") || ""),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, message: friendlyZodMessage(err) };
    }
    console.error(err);
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Something went wrong while updating. Please try again.",
    };
  }

  revalidatePath("/", "page");
  revalidatePath("/clients", "page");
  if (clientId) {
    revalidatePath(`/clients/${clientId}`, "page");
  }
  revalidatePath("/reports", "page");
  revalidatePath("/tasks", "page");

  return { ok: true, outcomeCode: String(formData.get("outcomeCode") || "") };
}

export type QuickCallResultActionState =
  | null
  | { ok: true; outcomeCode: string }
  | { ok: false; message: string };

export async function quickUpdateCallResultAction(
  _prev: QuickCallResultActionState,
  formData: FormData,
): Promise<QuickCallResultActionState> {
  const u = await getCurrentUser();
  assertPrivilege(getUserCapabilities(u).canEditCallLogs, "Your account can't change call results.");
  const clientId = String(formData.get("clientId") || "");
  const callLogId = String(formData.get("callLogId") || "");
  const outcomeCode = String(formData.get("outcomeCode") || "");

  try {
    await quickUpdateCallLogOutcomeCode(callLogId, clientId, outcomeCode);
  } catch (err) {
    console.error(err);
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not update call result.",
    };
  }

  revalidatePath("/", "page");
  revalidatePath("/clients", "page");
  if (clientId) revalidatePath(`/clients/${clientId}`, "page");
  revalidatePath("/reports", "page");
  revalidatePath("/tasks", "page");

  return { ok: true, outcomeCode };
}

export async function createCallResultOptionAction(formData: FormData) {
  await getCurrentUser();
  const label = String(formData.get("label") || "");
  const accentKey = String(formData.get("accentKey") || "slate");
  const hexRaw = formData.get("accentHex");
  const accentHex = hexRaw == null ? null : String(hexRaw).trim();
  await createCustomCallResultOption(label, accentKey, accentHex === "" ? null : accentHex);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/clients", "page");
  revalidatePath("/", "page");
  revalidatePath("/reports", "page");
}

export async function updateCallResultAccentAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  const accentKey = String(formData.get("accentKey") || "");
  const hexRaw = formData.get("accentHex");
  const accentHex = hexRaw == null ? null : String(hexRaw).trim();
  await updateCallResultOptionAccent(code, accentKey, accentHex === "" ? null : accentHex);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/clients", "page");
  revalidatePath("/", "page");
  revalidatePath("/reports", "page");
}

export async function updateCallResultLabelAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  const label = String(formData.get("label") || "");
  await updateCallResultOptionLabel(code, label);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/clients", "page");
  revalidatePath("/", "page");
  revalidatePath("/reports", "page");
}

function formatActionError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e.trim()) return e;
  if (e !== null && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    const bits = [o.code, o.details, o.hint].filter((x) => typeof x === "string" && String(x).trim()) as string[];
    if (bits.length) return bits.join(" — ");
  }
  try {
    return `Unexpected error: ${JSON.stringify(e)}`;
  } catch {
    return "Could not save changes.";
  }
}

export type CallResultOptionSaveRow = {
  code: string;
  label: string;
  accentKey: string;
  accentHex: string | null;
};

export type SaveAllCallResultsState = null | { ok: false; message: string };

/** Persists every status row from the Status settings page in one save. */
export async function saveAllCallResultOptionsAction(
  rows: CallResultOptionSaveRow[],
): Promise<SaveAllCallResultsState> {
  try {
    await getCurrentUser();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, message: "Nothing to save." };
    }
    for (const r of rows) {
      const code = String(r.code || "").trim();
      if (!code) {
        return { ok: false, message: "Invalid row: missing status code." };
      }
      const label = String(r.label || "");
      const accentKey = String(r.accentKey || "slate").trim() || "slate";
      const hexRaw = r.accentHex;
      const accentHex = hexRaw == null || String(hexRaw).trim() === "" ? null : String(hexRaw).trim();
      await updateCallResultOptionLabel(code, label);
      await updateCallResultOptionAccent(code, accentKey, accentHex);
    }
    revalidatePath("/settings", "page");
    revalidatePath("/calls", "page");
    revalidatePath("/clients", "page");
    revalidatePath("/", "page");
    revalidatePath("/reports", "page");
    return null;
  } catch (e) {
    console.error("[saveAllCallResultOptionsAction]", e);
    return {
      ok: false,
      message: formatActionError(e),
    };
  }
}

export async function setCallResultActiveAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  const active = String(formData.get("active") || "") === "true";
  await setCallResultOptionActive(code, active);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/clients", "page");
}

export async function removeCallResultOptionAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  await removeCustomCallResultOption(code);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/clients", "page");
}

export async function createBookingTypeOptionAction(formData: FormData) {
  await getCurrentUser();
  const label = String(formData.get("label") || "");
  const accentKey = String(formData.get("accentKey") || "slate");
  const hexRaw = formData.get("accentHex");
  const accentHex = hexRaw == null ? null : String(hexRaw).trim();
  await createCustomBookingTypeOption(label, accentKey, accentHex === "" ? null : accentHex);
  revalidatePath("/settings", "page");
  revalidatePath("/appointments", "page");
}

export async function updateBookingTypeAccentAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  const accentKey = String(formData.get("accentKey") || "");
  const hexRaw = formData.get("accentHex");
  const accentHex = hexRaw == null ? null : String(hexRaw).trim();
  await updateBookingTypeOptionAccent(code, accentKey, accentHex === "" ? null : accentHex);
  revalidatePath("/settings", "page");
  revalidatePath("/appointments", "page");
}

export async function updateBookingTypeLabelAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  const label = String(formData.get("label") || "");
  await updateBookingTypeOptionLabel(code, label);
  revalidatePath("/settings", "page");
  revalidatePath("/appointments", "page");
}

export type BookingTypeOptionSaveRow = {
  code: string;
  label: string;
  accentKey: string;
  accentHex: string | null;
};

export type SaveAllBookingTypesState = null | { ok: false; message: string };

export async function saveAllBookingTypeOptionsAction(
  rows: BookingTypeOptionSaveRow[],
): Promise<SaveAllBookingTypesState> {
  try {
    await getCurrentUser();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, message: "Nothing to save." };
    }
    for (const r of rows) {
      const code = String(r.code || "").trim();
      if (!code) {
        return { ok: false, message: "Invalid row: missing type code." };
      }
      const label = String(r.label || "");
      const accentKey = String(r.accentKey || "slate").trim() || "slate";
      const hexRaw = r.accentHex;
      const accentHex = hexRaw == null || String(hexRaw).trim() === "" ? null : String(hexRaw).trim();
      await updateBookingTypeOptionLabel(code, label);
      await updateBookingTypeOptionAccent(code, accentKey, accentHex);
    }
    revalidatePath("/settings", "page");
    revalidatePath("/appointments", "page");
    return null;
  } catch (e) {
    console.error("[saveAllBookingTypeOptionsAction]", e);
    return {
      ok: false,
      message: formatActionError(e),
    };
  }
}

export async function setBookingTypeActiveAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  const active = String(formData.get("active") || "") === "true";
  await setBookingTypeOptionActive(code, active);
  revalidatePath("/settings", "page");
  revalidatePath("/appointments", "page");
}

export async function removeBookingTypeOptionAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  await removeCustomBookingTypeOption(code);
  revalidatePath("/settings", "page");
  revalidatePath("/appointments", "page");
}

export async function createProductServiceOptionAction(formData: FormData) {
  await getCurrentUser();
  const label = String(formData.get("label") || "");
  const matchTermsRaw = formData.get("matchTerms");
  const matchTerms = matchTermsRaw == null ? null : String(matchTermsRaw).trim() || null;
  await createCustomProductServiceOption(label, matchTerms);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/reports", "page");
  revalidatePath("/clients", "page");
}

export type ProductServiceOptionSaveRow = {
  code: string;
  label: string;
  matchTerms: string;
};

export type SaveAllProductServicesState = null | { ok: false; message: string };

export async function saveAllProductServiceOptionsAction(
  rows: ProductServiceOptionSaveRow[],
): Promise<SaveAllProductServicesState> {
  try {
    await getCurrentUser();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, message: "Nothing to save." };
    }
    for (const r of rows) {
      const code = String(r.code || "").trim();
      if (!code) {
        return { ok: false, message: "Invalid row: missing code." };
      }
      await updateProductServiceOptionLabel(code, String(r.label || ""));
      await updateProductServiceOptionMatchTerms(code, String(r.matchTerms ?? ""));
    }
    revalidatePath("/settings", "page");
    revalidatePath("/calls", "page");
    revalidatePath("/reports", "page");
    revalidatePath("/clients", "page");
    return null;
  } catch (e) {
    console.error("[saveAllProductServiceOptionsAction]", e);
    return {
      ok: false,
      message: formatActionError(e),
    };
  }
}

export async function setProductServiceOptionActiveAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  const active = String(formData.get("active") || "") === "true";
  await setProductServiceOptionActive(code, active);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/reports", "page");
}

export async function removeProductServiceOptionAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  await removeCustomProductServiceOption(code);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/reports", "page");
  revalidatePath("/clients", "page");
}

export async function createLeadSourceOptionAction(formData: FormData) {
  await getCurrentUser();
  const label = String(formData.get("label") || "");
  await createCustomLeadSourceOption(label);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/clients", "page");
}

export type LeadSourceOptionSaveRow = {
  code: string;
  label: string;
};

export type SaveAllLeadSourcesState = null | { ok: false; message: string };

export async function saveAllLeadSourceOptionsAction(
  rows: LeadSourceOptionSaveRow[],
): Promise<SaveAllLeadSourcesState> {
  try {
    await getCurrentUser();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, message: "Nothing to save." };
    }
    for (const r of rows) {
      const code = String(r.code || "").trim();
      if (!code) {
        return { ok: false, message: "Invalid row: missing code." };
      }
      await updateLeadSourceOptionLabel(code, String(r.label || ""));
    }
    revalidatePath("/settings", "page");
    revalidatePath("/calls", "page");
    revalidatePath("/clients", "page");
    return null;
  } catch (e) {
    console.error("[saveAllLeadSourceOptionsAction]", e);
    return {
      ok: false,
      message: formatActionError(e),
    };
  }
}

export async function setLeadSourceOptionActiveAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  const active = String(formData.get("active") || "") === "true";
  await setLeadSourceOptionActive(code, active);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/clients", "page");
}

export async function removeLeadSourceOptionAction(formData: FormData) {
  await getCurrentUser();
  const code = String(formData.get("code") || "");
  await removeCustomLeadSourceOption(code);
  revalidatePath("/settings", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/clients", "page");
}

export async function createProductServiceOptionInlineAction(
  label: string,
): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  try {
    await getCurrentUser();
    const trimmed = label.trim();
    if (trimmed.length < 2) {
      return { ok: false, message: "Enter a name with at least 2 characters." };
    }
    const row = await createCustomProductServiceOption(trimmed, null);
    revalidatePath("/settings", "page");
    revalidatePath("/calls", "page");
    revalidatePath("/reports", "page");
    revalidatePath("/clients", "page");
    return { ok: true, code: String(row.code) };
  } catch (e) {
    return { ok: false, message: formatActionError(e) };
  }
}

export async function createAppointmentAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(
    getUserCapabilities(currentUser).canEditAppointments,
    "Your account can't create bookings.",
  );

  let clientId = String(formData.get("clientId") || "").trim();
  const newClientName = String(formData.get("newClientDisplayName") || "").trim();
  const newClientPhone = String(formData.get("newClientPhone") || "").trim();

  if (!clientId) {
    clientId = await createClientForBooking({
      displayName: newClientName,
      phone: newClientPhone || null,
    });
  }

  const kindRaw = String(formData.get("calendarEntryKind") || "EVENT");
  const calendarEntryKind = (CALENDAR_ENTRY_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as CalendarEntryKind)
    : "EVENT";

  const visibilityRaw = String(formData.get("visibility") || "default");
  const visibility =
    visibilityRaw === "public" || visibilityRaw === "private" || visibilityRaw === "confidential"
      ? visibilityRaw
      : ("default" as const);

  const showAs = String(formData.get("showAs") || "busy") === "free" ? ("free" as const) : ("busy" as const);
  const allDay =
    formData.get("allDay") === "on" || formData.get("allDay") === "true" || formData.get("allDay") === "1";

  const recurrenceRule = String(formData.get("recurrenceRule") || "").trim() || null;
  const location = String(formData.get("location") || "").trim() || null;
  const guestEmails = String(formData.get("guestEmails") || "").trim() || null;

  let vehicleId = String(formData.get("vehicleId") || "").trim();
  const newVehicleLabel = String(formData.get("newVehicleLabel") || "").trim();
  if (!vehicleId && newVehicleLabel.length >= 2) {
    const resolved = await resolveOrCreateVehicleForClient(clientId, newVehicleLabel);
    if (resolved) vehicleId = resolved;
  }

  const callLogIdField = String(formData.get("callLogId") || "").trim();
  const productQuoteLinesJson = String(formData.get("productQuoteLinesJson") || "").trim();
  const bookingNotes = String(formData.get("notes") || "").trim();

  let effectiveCallLogId = callLogIdField;
  if (!effectiveCallLogId) {
    const displayName =
      (await getClientDisplayName(clientId))?.trim() || newClientName.trim() || "Customer";
    const phone =
      newClientPhone.trim() || (await getClientPrimaryPhoneValue(clientId)) || undefined;
    let vehicleTextForLog = newVehicleLabel.trim();
    if (!vehicleTextForLog && vehicleId) {
      vehicleTextForLog = (await getVehicleLabelForClient(vehicleId, clientId)) ?? "";
    }
    const summary = bookingNotes || "Booking scheduled from calendar.";
    const startAtRaw = String(formData.get("startAt") || "");
    const { callLogId: createdLogId } = await addCallLog(
      {
        clientId,
        contactName: displayName,
        contactPhone: phone,
        vehicleText: vehicleTextForLog || undefined,
        summary,
        outcomeCode: CALL_OUTCOME_BOOKED_CODE,
        direction: CallDirection.INBOUND,
        happenedAt: startAtRaw || undefined,
        source: "BOOKING",
        productQuoteLinesJson: productQuoteLinesJson || undefined,
      },
      currentUser.id,
    );
    effectiveCallLogId = createdLogId;
  }

  await addAppointment(
    {
      clientId,
      vehicleId,
      title: String(formData.get("title") || ""),
      type: String(formData.get("type") || "INSTALL"),
      startAt: String(formData.get("startAt") || ""),
      durationMins: Number(formData.get("durationMins") || 60),
      resourceKey: String(formData.get("resourceKey") || "front-desk"),
      notes: bookingNotes,
      calendarEntryKind,
      location,
      guestEmails,
      allDay,
      recurrenceRule,
      showAs,
      visibility,
      depositText: String(formData.get("depositText") || "").trim() || null,
      callLogId: effectiveCallLogId || null,
    },
    currentUser.id,
  );

  revalidatePath("/", "page");
  revalidatePath("/appointments", "page");
  revalidatePath("/clients", "page");
  revalidatePath("/calls", "page");
  revalidatePath("/reports", "page");
}

export async function updateAppointmentAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(
    getUserCapabilities(currentUser).canEditAppointments,
    "Your account can't edit bookings.",
  );

  let clientId = String(formData.get("clientId") || "").trim();
  const newClientName = String(formData.get("newClientDisplayName") || "").trim();
  const newClientPhone = String(formData.get("newClientPhone") || "").trim();

  if (!clientId) {
    if (newClientName.length < 2) {
      throw new Error("Enter a client name (at least 2 characters) or pick an existing client.");
    }
    clientId = await createClientForBooking({
      displayName: newClientName,
      phone: newClientPhone || null,
    });
  }

  const kindRaw = String(formData.get("calendarEntryKind") || "EVENT");
  const calendarEntryKind = (CALENDAR_ENTRY_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as CalendarEntryKind)
    : "EVENT";

  const visibilityRaw = String(formData.get("visibility") || "default");
  const visibility =
    visibilityRaw === "public" || visibilityRaw === "private" || visibilityRaw === "confidential"
      ? visibilityRaw
      : ("default" as const);

  const showAs = String(formData.get("showAs") || "busy") === "free" ? ("free" as const) : ("busy" as const);
  const allDay =
    formData.get("allDay") === "on" || formData.get("allDay") === "true" || formData.get("allDay") === "1";

  let vehicleId = String(formData.get("vehicleId") || "").trim();
  const newVehicleLabel = String(formData.get("newVehicleLabel") || "").trim();
  if (!vehicleId && newVehicleLabel.length >= 2) {
    const resolved = await resolveOrCreateVehicleForClient(clientId, newVehicleLabel);
    if (resolved) vehicleId = resolved;
  }

  const appointmentIdForUpdate = String(formData.get("appointmentId") || "").trim();
  const previousClientId =
    appointmentIdForUpdate.length > 0 ? await getAppointmentClientId(appointmentIdForUpdate) : null;

  await updateAppointment(
    {
      appointmentId: appointmentIdForUpdate,
      clientId,
      vehicleId,
      title: String(formData.get("title") || ""),
      type: String(formData.get("type") || "INSTALL"),
      startAt: String(formData.get("startAt") || ""),
      endAt: String(formData.get("endAt") || ""),
      resourceKey: String(formData.get("resourceKey") || "front-desk"),
      notes: String(formData.get("notes") || "") || null,
      calendarEntryKind,
      location: String(formData.get("location") || "").trim() || null,
      guestEmails: String(formData.get("guestEmails") || "").trim() || null,
      allDay,
      recurrenceRule: String(formData.get("recurrenceRule") || "").trim() || null,
      showAs,
      visibility,
      depositText: String(formData.get("depositText") || "").trim() || null,
    },
    currentUser.id,
  );

  revalidatePath("/", "page");
  revalidatePath("/appointments", "page");
  revalidatePath("/clients", "page");
  revalidatePath(`/clients/${clientId}`, "page");
  if (previousClientId && previousClientId !== clientId) {
    revalidatePath(`/clients/${previousClientId}`, "page");
  }
}

export async function deleteAppointmentAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(
    getUserCapabilities(currentUser).canEditAppointments,
    "Your account doesn't have permission to remove bookings.",
  );
  const appointmentId = String(formData.get("appointmentId") || "").trim();
  if (!appointmentId) {
    throw new Error("Missing booking.");
  }
  const clientIdBefore = await getAppointmentClientId(appointmentId);
  await deleteAppointment(appointmentId, currentUser.id);
  revalidatePath("/", "page");
  revalidatePath("/appointments", "page");
  revalidatePath("/clients", "page");
  if (clientIdBefore) {
    revalidatePath(`/clients/${clientIdBefore}`, "page");
  }
}

export async function quickUpdateAppointmentTimesAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(
    getUserCapabilities(currentUser).canEditAppointments,
    "Your account can't change booking times.",
  );
  const appointmentId = String(formData.get("appointmentId") || "").trim();
  const startAt = String(formData.get("startAt") || "").trim();
  const endAt = String(formData.get("endAt") || "").trim();
  if (!appointmentId || !startAt || !endAt) {
    throw new Error("Missing booking or start/end times.");
  }
  const clientIdForApt = await getAppointmentClientId(appointmentId);
  await patchAppointmentTimesOnly(appointmentId, startAt, endAt, currentUser.id);
  revalidatePath("/", "page");
  revalidatePath("/appointments", "page");
  revalidatePath("/tasks", "page");
  revalidatePath("/clients", "page");
  if (clientIdForApt) {
    revalidatePath(`/clients/${clientIdForApt}`, "page");
  }
}

export async function createPaymentEventAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(
    getUserCapabilities(currentUser).canEditAppointments,
    "Your account can't record payments.",
  );
  const clientId = String(formData.get("clientId") || "").trim();
  if (!clientId) {
    throw new Error("Missing client.");
  }

  const lockApt = String(formData.get("lockAppointmentId") || "").trim();
  const aptPick = String(formData.get("appointmentId") || "").trim();
  const appointmentId = lockApt || (aptPick || null);

  const amountRaw = String(formData.get("amount") || "")
    .trim()
    .replace(/[^0-9.]/g, "");
  const dollars = Number(amountRaw);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error("Enter a valid amount greater than zero.");
  }
  const amountCents = Math.round(dollars * 100);
  if (amountCents < 1) {
    throw new Error("Amount too small.");
  }

  const kindRaw = String(formData.get("kind") || "DEPOSIT");
  const methodRaw = String(formData.get("method") || "CARD");
  if (!(PAYMENT_EVENT_KINDS as readonly string[]).includes(kindRaw)) {
    throw new Error("Invalid payment kind.");
  }
  if (!(PAYMENT_EVENT_METHODS as readonly string[]).includes(methodRaw)) {
    throw new Error("Invalid payment method.");
  }

  const receivedAt = String(formData.get("receivedAt") || "").trim();
  if (!receivedAt) {
    throw new Error("Choose when the payment was received.");
  }

  const callLogRaw = String(formData.get("callLogId") || "").trim();
  const callLogId = callLogRaw || null;
  const reference = String(formData.get("reference") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  await addPaymentEvent(
    {
      clientId,
      appointmentId,
      callLogId,
      kind: kindRaw as (typeof PAYMENT_EVENT_KINDS)[number],
      amountCents,
      receivedAt: new Date(receivedAt).toISOString(),
      method: methodRaw as (typeof PAYMENT_EVENT_METHODS)[number],
      reference,
      notes,
    },
    currentUser.id,
  );

  revalidatePath("/reports", "page");
  revalidatePath(`/clients/${clientId}`, "page");
  if (appointmentId) {
    revalidatePath(`/appointments/${appointmentId}/edit`, "page");
  }
  revalidatePath("/appointments", "page");
}

export async function updatePaymentEventAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(
    getUserCapabilities(currentUser).canEditAppointments,
    "Your account can't edit payment entries.",
  );
  const paymentEventId = String(formData.get("paymentEventId") || "").trim();
  const clientId = String(formData.get("clientId") || "").trim();
  if (!paymentEventId || !clientId) {
    throw new Error("Missing payment entry or client.");
  }

  const aptRaw = String(formData.get("appointmentId") || "").trim();
  const appointmentId = aptRaw || null;
  const callRaw = String(formData.get("callLogId") || "").trim();
  const callLogId = callRaw || null;

  const amountRaw = String(formData.get("amount") || "")
    .trim()
    .replace(/[^0-9.]/g, "");
  const dollars = Number(amountRaw);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error("Enter a valid amount greater than zero.");
  }
  const amountCents = Math.round(dollars * 100);
  if (amountCents < 1) {
    throw new Error("Amount too small.");
  }

  const kindRaw = String(formData.get("kind") || "DEPOSIT");
  const methodRaw = String(formData.get("method") || "CARD");
  if (!(PAYMENT_EVENT_KINDS as readonly string[]).includes(kindRaw)) {
    throw new Error("Invalid payment kind.");
  }
  if (!(PAYMENT_EVENT_METHODS as readonly string[]).includes(methodRaw)) {
    throw new Error("Invalid payment method.");
  }

  const receivedAt = String(formData.get("receivedAt") || "").trim();
  if (!receivedAt) {
    throw new Error("Choose when the payment was received.");
  }

  const reference = String(formData.get("reference") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  await updatePaymentEvent(
    {
      paymentEventId,
      clientId,
      appointmentId,
      callLogId,
      kind: kindRaw as (typeof PAYMENT_EVENT_KINDS)[number],
      amountCents,
      receivedAt: new Date(receivedAt).toISOString(),
      method: methodRaw as (typeof PAYMENT_EVENT_METHODS)[number],
      reference,
      notes,
    },
    currentUser.id,
  );

  revalidatePath("/reports", "page");
  revalidatePath(`/clients/${clientId}`, "page");
  if (appointmentId) {
    revalidatePath(`/appointments/${appointmentId}/edit`, "page");
  }
  revalidatePath("/appointments", "page");
}

export async function deletePaymentEventAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(
    getUserCapabilities(currentUser).canEditAppointments,
    "Your account can't remove payment entries.",
  );
  const paymentEventId = String(formData.get("paymentEventId") || "").trim();
  if (!paymentEventId) {
    throw new Error("Missing payment entry.");
  }
  const meta = await deletePaymentEvent(paymentEventId);
  revalidatePath("/reports", "page");
  revalidatePath(`/clients/${meta.clientId}`, "page");
  if (meta.appointmentId) {
    revalidatePath(`/appointments/${meta.appointmentId}/edit`, "page");
  }
  revalidatePath("/appointments", "page");
}

export async function rescheduleAppointmentAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(
    getUserCapabilities(currentUser).canEditAppointments,
    "Your account can't reschedule bookings.",
  );
  const appointmentId = String(formData.get("appointmentId") || "").trim();
  const startAtRaw = String(formData.get("startAt") || "").trim();
  if (!appointmentId || !startAtRaw) {
    throw new Error("Missing booking or start time.");
  }
  const newStart = new Date(startAtRaw);
  if (Number.isNaN(newStart.getTime())) {
    throw new Error("Invalid start time.");
  }
  const clientIdForApt = await getAppointmentClientId(appointmentId);
  await rescheduleCrmAppointment(appointmentId, newStart, currentUser.id);
  revalidatePath("/", "page");
  revalidatePath("/appointments", "page");
  revalidatePath("/clients", "page");
  if (clientIdForApt) {
    revalidatePath(`/clients/${clientIdForApt}`, "page");
  }
}

/** Move a Google-only timed event (same calendar source as the grid). */
export async function rescheduleGoogleCalendarEventAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(
    getUserCapabilities(currentUser).canEditAppointments,
    "Your account can't change calendar events.",
  );
  const eventId = String(formData.get("eventId") || "").trim();
  const startAtRaw = String(formData.get("startAt") || "").trim();
  const endAtRaw = String(formData.get("endAt") || "").trim();
  if (!eventId || !startAtRaw || !endAtRaw) {
    throw new Error("Missing event or time range.");
  }
  const start = new Date(startAtRaw);
  const end = new Date(endAtRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    throw new Error("Invalid start or end time.");
  }

  const userRt = currentUser.googleRefreshToken?.trim();
  const refreshToken = userRt || getGoogleRefreshToken()?.trim();
  if (!refreshToken) {
    throw new Error("Connect Google Calendar (Settings) or configure a shop calendar token.");
  }
  const calendarId = userRt
    ? resolveUserGoogleCalendarId(currentUser.googleCalendarId)
    : getGoogleCalendarIdFromEnv() ?? "primary";

  await patchCalendarEventWithRefreshToken(refreshToken, calendarId, eventId, {
    start,
    end,
    allDay: false,
  });

  revalidatePath("/appointments", "page");
  revalidatePath("/", "page");
}

export async function importCsvAction(formData: FormData) {
  const currentUser = await getCurrentUser();
  assertPrivilege(getUserCapabilities(currentUser).canRunImports, "Your account can't run imports.");
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Please choose a CSV file to import.");
  }
  if (file.size === 0) {
    throw new Error("The selected file is empty.");
  }

  const text = await file.text();
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed.length) {
    throw new Error("The CSV file has no readable text (only blank or BOM).");
  }

  await importCsvText(
    {
      fileName: file.name || "uploaded.csv",
      csvText: text,
    },
    currentUser.id,
  );

  revalidatePath("/");
  revalidatePath("/imports");
  revalidatePath("/clients");
  revalidatePath("/reports");
}
