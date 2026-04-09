import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | undefined;

/**
 * Server-only Supabase client with the service role key.
 * Bypasses RLS; use only in Server Components, Server Actions, and Route Handlers.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !key && "SUPABASE_SERVICE_ROLE_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Missing ${missing} in .env. Copy the project URL and the service_role secret from Supabase (Settings → API). The publishable/anon key is not a substitute for the service role.`,
    );
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
