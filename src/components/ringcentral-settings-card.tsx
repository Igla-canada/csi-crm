"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  canConfigure: boolean;
  configured: boolean;
};

export function RingCentralSettingsCard({ canConfigure, configured }: Props) {
  const router = useRouter();
  const [hoursBack, setHoursBack] = useState(48);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [subPending, setSubPending] = useState(false);
  const [subMessage, setSubMessage] = useState<string | null>(null);

  async function runSync() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ringcentral/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoursBack }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setMessage(typeof data?.error === "string" ? data.error : `Request failed (${res.status}).`);
        return;
      }
      const parts = [
        `Fetched ${data?.fetched ?? "—"}`,
        `upserted ${data?.upserted ?? "—"}`,
        `skipped ${data?.skipped ?? "—"}`,
        `transcription jobs started ${data?.transcribeStarted ?? "—"}`,
      ];
      const warns = data?.warnings;
      if (Array.isArray(warns) && warns.length) {
        parts.push(`Note: ${warns.join(" ")}`);
      }
      const errs = data?.errors;
      if (Array.isArray(errs) && errs.length) {
        parts.push(`Errors: ${errs.slice(0, 5).join("; ")}`);
      }
      setMessage(parts.join(". ") + ".");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setPending(false);
    }
  }

  async function registerTelephonyWebhook() {
    setSubPending(true);
    setSubMessage(null);
    try {
      const res = await fetch("/api/ringcentral/telephony-subscribe", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setSubMessage(typeof data?.error === "string" ? data.error : `Request failed (${res.status}).`);
        return;
      }
      const sub = data?.subscription as Record<string, unknown> | undefined;
      const id = sub?.id != null ? String(sub.id) : "—";
      const exp = sub?.expirationTime != null ? String(sub.expirationTime) : "—";
      setSubMessage(
        `Webhook registered. Subscription id ${id}. Expires ${exp}. RingCentral renews or you can register again before expiry.`,
      );
      router.refresh();
    } catch (e) {
      setSubMessage(e instanceof Error ? e.message : "Subscription request failed.");
    } finally {
      setSubPending(false);
    }
  }

  return (
    <section className="crm-soft-panel rounded-[28px] p-6">
      <h3 className="text-xl font-semibold text-slate-900">RingCentral (passive)</h3>
      <p className="mt-3 rounded-2xl border border-slate-200/90 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-800">
        <span className="font-semibold text-slate-900">Read-only on the phone system.</span> This CRM does not answer,
        hang up, transfer, park, or dial calls. It only <span className="font-medium">reads</span> call history and live
        session notifications, stores copies in your database, and lets staff log activity in the CRM. Optional AI
        transcription asks RingCentral to process a <span className="font-medium">stored</span> recording — it does not
        control the live line.
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        JWT-based server sync pulls account call logs, stores recording references and optional AI transcripts, and
        creates draft call cards for staff to complete. Recording playback uses a signed-in session proxy; RingCentral
        keeps the audio files.
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        <span className="font-semibold text-slate-800">AI transcripts</span> need a{" "}
        <span className="font-medium">public</span> <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">APP_URL</code>{" "}
        (HTTPS in production, or a tunnel — not plain localhost) so RingCentral can POST results to{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/api/ringcentral/ai-webhook</code>. Your RingCentral
        app must include the <span className="font-medium">AI</span> permission. Staff can use{" "}
        <span className="font-medium">Request AI transcript</span> on a call on the client card, or set{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">RINGCENTRAL_AUTO_TRANSCRIBE=true</code> to queue jobs
        during sync for any log that has a recording but no transcript yet.
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        <span className="font-semibold text-slate-800">Live call dock (ringing)</span>: the header dock receives{" "}
        <span className="font-medium">listen-only</span> account telephony session webhooks at{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/api/ringcentral/telephony-webhook</code> (incoming
        HTTP only — we never send call-control commands back to RingCentral). That covers calls on your whole RingCentral
        account (not only the JWT extension).{" "}
        <span className="font-medium">APP_URL</span> must be a public HTTPS base (ngrok is fine). After migration{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">TelephonyLiveSession</code>, use the button below once
        (or after each ngrok URL change). Multiple simultaneous calls show as multiple lines. Extension REST polling is
        off by default; set{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">RINGCENTRAL_SKIP_EXTENSION_ACTIVE_CALLS=false</code>{" "}
        only if you need active-calls merged from RingCentral’s API.
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        <span className="font-semibold text-slate-800">Call logs in the database</span>: when a telephony session ends,
        RingCentral POSTs to the webhook and the server tries to import the matching account call-log row immediately; if
        the log is not available yet, it creates a short-lived placeholder (id{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">webhook-ts:…</code>) until you run{" "}
        <span className="font-medium">Sync call logs now</span> below. Optional: an external scheduler (e.g. cron-job.org)
        can <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">GET /api/ringcentral/sync-cron</code> with{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">Authorization: Bearer</code>{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">CRON_SECRET</code> — not required if you sync manually.
        Set <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">NEXT_PUBLIC_UI_LIVE_REFRESH_SEC</code> to{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">sync</code> (or a seconds value) so open tabs refresh
        with the live call poll; staff can pause under Settings → Live UI refresh while debugging.
      </p>
      {!configured ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Not configured. Add{" "}
          <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs">RINGCENTRAL_CLIENT_ID</code>,{" "}
          <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs">RINGCENTRAL_CLIENT_SECRET</code>,{" "}
          <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs">RINGCENTRAL_JWT</code>, and{" "}
          <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs">RINGCENTRAL_INTEGRATION_USER_ID</code> to{" "}
          <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs">.env</code> (see{" "}
          <code className="rounded bg-amber-100/80 px-1 py-0.5 text-xs">.env.example</code>).
        </p>
      ) : null}
      {canConfigure && configured ? (
        <div className="mt-6 space-y-3 rounded-[22px] border border-slate-200/90 bg-slate-50/60 p-4">
          <label className="block text-sm font-semibold text-slate-900" htmlFor="rcHoursBack">
            Hours of history
          </label>
          <input
            id="rcHoursBack"
            type="number"
            min={1}
            max={168}
            value={hoursBack}
            onChange={(e) => setHoursBack(Number(e.target.value) || 48)}
            className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => void runSync()}
            className="rounded-xl bg-[#1e5ea8] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#17497f] disabled:opacity-50"
          >
            {pending ? "Syncing…" : "Sync call logs now"}
          </button>
          {message ? (
            <p className="text-sm text-slate-700" role="status">
              {message}
            </p>
          ) : null}
          <div className="border-t border-slate-200/80 pt-4">
            <p className="text-sm font-semibold text-slate-900">Live dock — telephony webhook (listen-only)</p>
            <p className="mt-1 text-xs text-slate-600">
              Tells RingCentral where to POST session <span className="font-medium">notifications</span> (read-only
              events). Does not enable answering or controlling calls from the CRM.
            </p>
            <button
              type="button"
              disabled={subPending}
              onClick={() => void registerTelephonyWebhook()}
              className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              {subPending ? "Registering…" : "Register listen-only telephony webhook"}
            </button>
            {subMessage ? (
              <p className="mt-2 text-xs text-slate-700" role="status">
                {subMessage}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {canConfigure && !configured ? (
        <p className="mt-4 text-xs text-slate-500">Configure environment variables first, then reload this page.</p>
      ) : null}
      {!canConfigure ? (
        <p className="mt-4 text-sm text-slate-500">Only workspace administrators can run RingCentral sync.</p>
      ) : null}
    </section>
  );
}
