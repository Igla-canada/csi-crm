# Live call dock — setup and testing

## Read-only telephony (no call control)

This integration is **observe-only** for the phone system: the CRM **does not** answer, hang up, transfer, park, forward, or place outbound calls through RingCentral APIs. It only:

- **Reads** call logs and (optionally) extension active-call snapshots via GET APIs  
- **Receives** telephony session webhooks (RingCentral → CRM HTTP POSTs) and stores a short-lived mirror in `TelephonyLiveSession` for the dock  
- **Proxies** recording playback to signed-in users (stream read)  
- **Optionally** requests AI transcription of **already stored** recordings (RingCentral processes the file; this is not live call control)

Do not add RingCentral **Call Control** session commands (answer, hold, transfer, etc.) to this product without an explicit, separate decision — it would change that guarantee.

---

The **Live sync** switch in the CRM **header** controls:

1. **Page refresh** — `NEXT_PUBLIC_UI_LIVE_REFRESH_SEC` (`sync` / `live` / seconds). See `.env.example`. Auto-refresh skips **`/calls`** (Log a call). With Live sync on, **`/calls/history`** still refreshes on the dock interval if the env is unset.
2. **Call history table** — polls `GET /api/calls/inbound-history` so rows update from the database without relying only on RSC refresh. **New calls** usually appear when the **telephony webhook** ends a session (server imports call log or writes a `webhook-ts:` placeholder), or after **Settings → Sync call logs now**. The refresh button is optional; it triggers the same JSON fetch plus `router.refresh()`.
3. **Live call dock** — the browser calls `GET /api/ringcentral/active-calls` on an interval (default **30s**, floor **30s**). That response **merges**:
   - **Account telephony webhooks** (recommended): RingCentral POSTs to `/api/ringcentral/telephony-webhook`; the CRM stores rows in **`TelephonyLiveSession`** and serves them on every poll. Covers **all extensions / lines on the account** when the subscription uses `/restapi/v1.0/account/~/telephony/sessions`. **Multiple simultaneous calls** → multiple rows in the dock.
   - **Extension active-calls API** (optional): `GET …/extension/~/active-calls` for the JWT extension only. Set **`RINGCENTRAL_SKIP_EXTENSION_ACTIVE_CALLS=true`** to disable this leg and avoid RingCentral rate limits when webhooks are enough.

## Recommended: register the telephony webhook

1. Apply the DB migration that creates **`TelephonyLiveSession`** (`supabase/migrations/20260406180000_telephony_live_session.sql` or equivalent).
2. Set **`APP_URL`** to your **public HTTPS** base (production domain or **ngrok** — not plain `localhost` from RingCentral’s point of view).
3. As an admin: **Workspace → RingCentral → Register telephony webhook** (or `POST /api/ringcentral/telephony-subscribe`). Your RingCentral app needs permission to **receive telephony session notifications** (wording varies; often Call Control / session webhooks).
4. Turn **Live sync** on. When a call rings, webhooks should populate the dock within one poll tick (plus webhook latency).

Webhook validation: RingCentral sends a **`Validation-Token`** header on setup; the route echoes it in the response header (required).

## RingCentral requirements (call-log sync unchanged)

- `RINGCENTRAL_CLIENT_ID`, `RINGCENTRAL_CLIENT_SECRET`, `RINGCENTRAL_JWT`, `RINGCENTRAL_INTEGRATION_USER_ID`.
- Call-log sync and recording behavior are unchanged; the dock webhook is **separate** from `ai-webhook`.

## CRM requirements

- **Calls** section access for the dock API; **Log a Call** to use **Open call log**.

## Troubleshooting

| Symptom | What to check |
|--------|----------------|
| Listening pill, no card when phone rings | **RingCentral never hits `localhost`.** `APP_URL` must be the same public HTTPS base you registered (e.g. ngrok). While signed in as admin, open **`GET /api/ringcentral/telephony-debug`** — check `webhookExpectedAt`, `rowCount`, `ringCentralSubscriptions`, `subscriptionsMatchingCurrentWebhookUrl`, and `hints`. During a call, watch the **`next dev` terminal** for `[telephony-webhook]`; if you see `No session payloads parsed`, the payload shape may need a parser tweak (log includes a JSON snippet). |
| Extension poll empty but webhook should work | Inspect Network → `active-calls` → JSON `webhookSessions`. If 0, webhooks are not reaching the server or the payload shape differs — check server logs in dev. |
| Amber dock error, `webhookSessions` still > 0 | Merged calls should still show; if not, file an issue with the response JSON. |
| Call history never shows new calls | That list is **database**-backed. Confirm telephony webhooks fire when calls end, or run **Sync call logs now** (optional external ping to `sync-cron` with `CRON_SECRET`). |
| Rate limit on active-calls | Set `RINGCENTRAL_SKIP_EXTENSION_ACTIVE_CALLS=true` and rely on webhooks; or raise `NEXT_PUBLIC_LIVE_ACTIVE_CALL_POLL_SEC`. |

## Files involved

- `src/app/api/ringcentral/telephony-webhook/route.ts` — RingCentral POST + validation token  
- `src/lib/ringcentral/telephony-session-notify.ts` — parse session payloads, upsert/delete DB rows  
- `src/lib/ringcentral/telephony-live-sessions.ts` — Supabase CRUD + TTL cleanup  
- `src/app/api/ringcentral/telephony-subscribe/route.ts` — admin: create subscription  
- `src/app/api/ringcentral/telephony-debug/route.ts` — admin: JSON snapshot of `TelephonyLiveSession` + setup hints  
- `src/lib/ringcentral/sync-call-logs.ts` — `importCallLogForTelephonySessionEnd` (webhook-triggered import)  
- `src/app/api/ringcentral/active-calls/route.ts` — merge webhook + extension poll for the dock  
- `src/components/live-call-dock.tsx` — UI  
- `src/components/ringcentral-settings-card.tsx` — “Register telephony webhook”  
