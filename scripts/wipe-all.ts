/**
 * Deletes ALL CRM data including users, then inserts minimal workspace defaults
 * (call statuses, booking types, products, calendar config) with ZERO users.
 *
 * After this, open the app → you are redirected to /login → sign in with Google.
 * The first Google account becomes ADMIN; add teammates under Workspace → Team.
 *
 * Usage:
 *   npm run db:wipe-all:confirm
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

import { tables as T } from "../src/lib/db/tables";

function id() {
  return randomUUID();
}

function now() {
  return new Date().toISOString();
}

async function clearEverything(supabase: SupabaseClient) {
  const wipeId = async (table: string) => {
    const { error } = await supabase.from(table).delete().neq("id", "");
    if (error) throw error;
  };
  await wipeId(T.ImportRow);
  await wipeId(T.ImportBatch);
  await wipeId(T.Appointment);
  const { error: btoDel } = await supabase.from(T.BookingTypeOption).delete().neq("code", "");
  if (btoDel) throw btoDel;
  const { error: psDel } = await supabase.from(T.ProductServiceOption).delete().neq("code", "");
  if (psDel) throw psDel;
  await wipeId(T.Opportunity);
  await wipeId(T.CallLog);
  await wipeId(T.AuditLog);
  await wipeId(T.ContactPoint);
  await wipeId(T.Vehicle);
  await wipeId(T.Client);
  const { error: optDel } = await supabase.from(T.CallResultOption).delete().neq("code", "");
  if (optDel) throw optDel;
  await wipeId(T.CalendarConfig);
  await wipeId(T.User);
}

async function insertWorkspaceDefaults(supabase: SupabaseClient) {
  const { error: optErr } = await supabase.from(T.CallResultOption).insert([
    { code: "QUOTE_SENT", label: "Quote sent", sortOrder: 10, isBuiltIn: true, active: true, accentKey: "sky", accentHex: null, createdAt: now() },
    { code: "CALLBACK_NEEDED", label: "Callback needed", sortOrder: 20, isBuiltIn: true, active: true, accentKey: "amber", accentHex: null, createdAt: now() },
    { code: "BOOKED", label: "Book", sortOrder: 30, isBuiltIn: true, active: true, accentKey: "cyan", accentHex: null, createdAt: now() },
    { code: "SUPPORT", label: "Support", sortOrder: 40, isBuiltIn: true, active: true, accentKey: "violet", accentHex: null, createdAt: now() },
    { code: "NO_SOLUTION", label: "No solution", sortOrder: 50, isBuiltIn: true, active: true, accentKey: "rose", accentHex: null, createdAt: now() },
    { code: "COMPLETED", label: "Completed", sortOrder: 60, isBuiltIn: true, active: true, accentKey: "emerald", accentHex: null, createdAt: now() },
    { code: "ARCHIVED", label: "Archived", sortOrder: 65, isBuiltIn: true, active: true, accentKey: "slate", accentHex: null, createdAt: now() },
    { code: "FOLLOW_UP", label: "Follow up", sortOrder: 70, isBuiltIn: true, active: true, accentKey: "orange", accentHex: null, createdAt: now() },
  ]);
  if (optErr) throw optErr;

  const { error: btypeErr } = await supabase.from(T.BookingTypeOption).insert([
    { code: "INSTALL", label: "Install", sortOrder: 10, isBuiltIn: true, active: true, accentKey: "indigo", accentHex: null, createdAt: now() },
    { code: "INSPECTION", label: "Inspection", sortOrder: 20, isBuiltIn: true, active: true, accentKey: "sky", accentHex: null, createdAt: now() },
    { code: "SUPPORT", label: "Support", sortOrder: 30, isBuiltIn: true, active: true, accentKey: "violet", accentHex: null, createdAt: now() },
    { code: "QUOTE_VISIT", label: "Quote visit", sortOrder: 40, isBuiltIn: true, active: true, accentKey: "amber", accentHex: null, createdAt: now() },
    { code: "PHONE_CALL", label: "Phone call", sortOrder: 50, isBuiltIn: true, active: true, accentKey: "cyan", accentHex: null, createdAt: now() },
  ]);
  if (btypeErr) throw btypeErr;

  const { error: psErr } = await supabase.from(T.ProductServiceOption).insert([
    { code: "GENERAL", label: "General", matchTerms: "general,general inquiry,inquiry", sortOrder: 5, isBuiltIn: true, active: true, createdAt: now() },
    { code: "IGLA", label: "IGLA", matchTerms: "igla", sortOrder: 10, isBuiltIn: false, active: true, createdAt: now() },
    { code: "DASH_CAM", label: "Dash cam", matchTerms: "dash cam,dashcam,dash-cam", sortOrder: 15, isBuiltIn: false, active: true, createdAt: now() },
  ]);
  if (psErr) throw psErr;

  const { error: calErr } = await supabase.from(T.CalendarConfig).insert({
    id: id(),
    calendarId: "primary",
    maxParallelBookings: 5,
    defaultDurationMins: 90,
    workingHoursJson: JSON.stringify({
      monday: ["09:00", "18:00"],
      tuesday: ["09:00", "18:00"],
      wednesday: ["09:00", "18:00"],
      thursday: ["09:00", "18:00"],
      friday: ["09:00", "17:00"],
      saturday: ["10:00", "15:00"],
    }),
    createdAt: now(),
    updatedAt: now(),
  });
  if (calErr) throw calErr;
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error(
      "Refusing to wipe: pass --confirm to delete ALL users and CRM data, then restore default options only.\n" +
        "Example: npx tsx scripts/wipe-all.ts --confirm\n" +
        "Then sign in at /login with Google (first user = ADMIN).",
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log("Wiping all CRM data and users…");
  await clearEverything(supabase);
  console.log("Inserting default workspace options (no users)…");
  await insertWorkspaceDefaults(supabase);
  console.log("Done. Clear browser cookies for this app, open /login, and sign in with Google.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
