import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { CRM_USER_COOKIE } from "@/lib/crm-user-constants";
import { getSupabaseAdmin, tables, type UserRole } from "@/lib/db";

const DEFAULT_EMAIL = "admin@carsystemscrm.local";

export type CrmUserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  team: string | null;
  /** JSON from DB; merged with role defaults in `getUserCapabilities`. */
  privilegeOverrides?: unknown;
  googleRefreshToken?: string | null;
  googleCalendarId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getCurrentUser(): Promise<CrmUserRow> {
  const cookieStore = await cookies();
  const allowDefault = process.env.CRM_ALLOW_DEFAULT_USER === "true";
  let email = cookieStore.get(CRM_USER_COOKIE)?.value?.trim().toLowerCase();

  if (!email) {
    if (allowDefault) {
      email = DEFAULT_EMAIL;
    } else {
      redirect("/login");
    }
  }

  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase.from(tables.User).select("*").eq("email", email).maybeSingle();
  if (user) return user as CrmUserRow;

  if (allowDefault) {
    const { data: fallback } = await supabase.from(tables.User).select("*").eq("email", DEFAULT_EMAIL).maybeSingle();
    if (fallback) return fallback as CrmUserRow;
  }

  redirect("/login?error=unknown_user");
}

/** Same resolution as `getCurrentUser` but returns null instead of redirecting (for Route Handlers). */
export async function getCurrentUserForApi(): Promise<CrmUserRow | null> {
  // Tie auth to the real request so Route Handlers are not treated as static/cached with an empty cookie store
  // (fixes periodic 401 from the live dock ~30s after load on some hosts).
  await connection();
  const cookieStore = await cookies();
  const allowDefault = process.env.CRM_ALLOW_DEFAULT_USER === "true";
  let email = cookieStore.get(CRM_USER_COOKIE)?.value?.trim().toLowerCase();

  if (!email) {
    if (allowDefault) {
      email = DEFAULT_EMAIL;
    } else {
      return null;
    }
  }

  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase.from(tables.User).select("*").eq("email", email).maybeSingle();
  if (user) return user as CrmUserRow;

  if (allowDefault) {
    const { data: fallback } = await supabase.from(tables.User).select("*").eq("email", DEFAULT_EMAIL).maybeSingle();
    if (fallback) return fallback as CrmUserRow;
  }

  return null;
}

export function hasAnyRole(role: UserRole, allowed: UserRole[]) {
  return allowed.includes(role);
}
