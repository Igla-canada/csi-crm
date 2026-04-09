import "server-only";

export { CRM_USER_COOKIE } from "@/lib/crm-user-constants";

/** After Google sign-in, keep users logged in across browser restarts (~400 days). */
export const CRM_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 400;

export function getCrmSessionCookieOptions(maxAgeSec: number = CRM_SESSION_MAX_AGE_SEC) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: maxAgeSec,
  };
}
