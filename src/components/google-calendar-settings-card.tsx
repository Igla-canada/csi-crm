import { Card } from "@/components/app-shell";
import type { CrmUserRow } from "@/lib/auth";
import { disconnectGoogleCalendarAction, saveMyGoogleCalendarIdAction } from "@/app/actions";

type Props = {
  user: CrmUserRow;
  googleBanner?: "connected" | "error" | null;
  googleErrorMessage?: string | null;
};

export function GoogleCalendarSettingsCard({ user, googleBanner, googleErrorMessage }: Props) {
  const connected = Boolean(user.googleRefreshToken?.trim());
  const calendarHint = user.googleCalendarId?.trim() || "primary (main calendar)";

  return (
    <Card>
      <h3 className="text-xl font-semibold text-slate-900">Your Google Calendar</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        When you book an appointment, it can be added to your Google calendar using your own account. Shop-wide
        <span className="whitespace-nowrap"> </span>
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">GOOGLE_REFRESH_TOKEN</code> in
        <span className="whitespace-nowrap"> </span>
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env</code> is only used if you have not connected
        here.
      </p>
      {googleBanner === "connected" ? (
        <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Google Calendar is connected for your user.
        </p>
      ) : null}
      {googleBanner === "error" ? (
        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          Could not save the Google connection{googleErrorMessage ? `: ${googleErrorMessage}` : "."}
        </p>
      ) : null}
      <div className="mt-6 space-y-4">
        {connected ? (
          <>
            <div className="crm-soft-row rounded-[22px] p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Status</p>
              <p className="mt-2">
                Connected. Target calendar: <span className="font-mono text-xs text-slate-800">{calendarHint}</span>
              </p>
            </div>
            <form action={saveMyGoogleCalendarIdAction} className="crm-soft-row rounded-[22px] p-4 space-y-3">
              <label className="block text-sm font-semibold text-slate-900" htmlFor="googleCalendarId">
                Optional calendar ID
              </label>
              <p className="text-xs leading-5 text-slate-500">
                Leave empty to use your primary calendar. Otherwise paste the ID from Google Calendar → Settings →
                Integrate calendar.
              </p>
              <input
                id="googleCalendarId"
                name="googleCalendarId"
                type="text"
                defaultValue={user.googleCalendarId ?? ""}
                placeholder="primary"
                className="w-full max-w-lg rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
              />
              <button
                type="submit"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Save calendar ID
              </button>
            </form>
            <form action={disconnectGoogleCalendarAction}>
              <button
                type="submit"
                className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900 transition hover:border-red-400 hover:bg-red-100"
              >
                Disconnect Google
              </button>
            </form>
          </>
        ) : (
          <a
            href="/api/google/oauth"
            className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Connect Google Calendar
          </a>
        )}
      </div>
    </Card>
  );
}
