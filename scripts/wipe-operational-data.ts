/**
 * Deletes all clients and related CRM data so you can test on a fresh slate.
 *
 * Keeps: User, CallResultOption, BookingTypeOption, ProductServiceOption, CalendarConfig
 *
 * Usage:
 *   npm run db:wipe:confirm
 *   npx tsx scripts/wipe-operational-data.ts --confirm
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { tables as T } from "../src/lib/db/tables";

async function wipeId(supabase: SupabaseClient, table: string) {
  const { error } = await supabase.from(table).delete().neq("id", "");
  if (error) throw error;
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error(
      "Refusing to wipe: pass --confirm to delete all clients and operational data.\n" +
        "Example: npx tsx scripts/wipe-operational-data.ts --confirm",
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log("Wiping operational data (clients, calls, bookings, imports)…");

  await wipeId(supabase, T.ImportRow);
  await wipeId(supabase, T.ImportBatch);
  await wipeId(supabase, T.Appointment);
  await wipeId(supabase, T.Opportunity);
  await wipeId(supabase, T.CallLog);
  await wipeId(supabase, T.AuditLog);
  await wipeId(supabase, T.ContactPoint);
  await wipeId(supabase, T.Vehicle);
  await wipeId(supabase, T.Client);

  console.log("Done. Users, workspace settings (status, booking types, products), and calendar config are unchanged.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
