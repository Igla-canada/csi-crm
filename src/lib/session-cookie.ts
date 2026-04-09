import "server-only";

export { CRM_USER_COOKIE } from "@/lib/crm-user-constants";

/** After Google sign-in, keep users logged in across browser restarts (~400 days). */
export const CRM_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 400;

export function getCrmSessionCookieOptions(maxAgeSec: number = CRM_SESSION_MAX_AGE_SEC) {
  const maxAge = maxAgeSec;
  // OAuth returns via a cross-site top-level navigation (accounts.google.com → this origin). Some browsers
  // reject new session cookies with SameSite=Lax on that response, so Application → Cookies stays empty and
  // every fetch (e.g. active-calls) is Unauthorized. SameSite=None + Secure is standard for production HTTPS.
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true as const,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/" as const,
    maxAge,
    expires: new Date(Date.now() + maxAge * 1000),
  };
}
