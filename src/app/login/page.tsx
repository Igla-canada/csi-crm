import Link from "next/link";

import { getGoogleOAuthEnv } from "@/lib/google-calendar/env";

import { GoogleSignInButton } from "./google-sign-in-button";

type LoginPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const sp = (await searchParams) ?? {};
  const oauthReady = Boolean(getGoogleOAuthEnv());
  const allowDefault = process.env.CRM_ALLOW_DEFAULT_USER === "true";

  const errorCopy: Record<string, string> = {
    not_invited:
      "This Google account is not on your team yet. Ask an administrator to add your email under Workspace → Team.",
    no_email: "Google did not share an email address. Try another Google account or check your Google privacy settings.",
    unknown_user: "Your session does not match any user. Sign in again.",
    signin: sp.message?.trim() ? sp.message : "Sign-in failed. Try again.",
  };
  const errKey = sp.error?.trim();
  const errorMessage = errKey ? errorCopy[errKey] ?? `Something went wrong (${errKey}).` : null;

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gradient-to-b from-[#e8f0fa] to-[#f4f7fb] px-4 py-16">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200/80 bg-white/90 p-8 shadow-lg shadow-slate-200/60 backdrop-blur-sm">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Car Systems</p>
        <h1 className="mt-3 text-center text-2xl font-semibold tracking-tight text-slate-900">Sign in to CRM</h1>
        <p className="mt-2 text-center text-sm leading-6 text-slate-600">
          Use your Google workspace account. The <span className="font-medium text-slate-800">first</span> sign-in on an
          empty database becomes the owner (ADMIN). After that, only emails added under{" "}
          <span className="font-medium text-slate-800">Workspace → Team</span> can sign in.
        </p>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm leading-6 text-red-900"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-8 space-y-4">
          {oauthReady ? (
            <GoogleSignInButton />
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
              Google sign-in is not configured. Set <code className="text-xs">GOOGLE_CLIENT_ID</code>,{" "}
              <code className="text-xs">GOOGLE_CLIENT_SECRET</code>, and <code className="text-xs">APP_URL</code> or{" "}
              <code className="text-xs">GOOGLE_REDIRECT_URI</code> in <code className="text-xs">.env</code>, then restart
              the dev server.
            </div>
          )}

          {allowDefault ? (
            <p className="text-center text-xs leading-5 text-slate-500">
              Dev mode: <code className="text-[11px]">CRM_ALLOW_DEFAULT_USER=true</code> skips sign-in; open the app
              directly.
            </p>
          ) : null}
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">
          After sign-in, connect Google Calendar from{" "}
          <Link href="/settings" className="font-medium text-[#1e5ea8] hover:underline">
            Workspace → General
          </Link>{" "}
          if you use bookings sync.
        </p>
      </div>
    </div>
  );
}
